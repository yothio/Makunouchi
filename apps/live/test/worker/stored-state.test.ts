import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { SessionRoom } from "../../src/worker/session-room";
import { STATE_SCHEMA_VERSION, STATE_VERSION_KEY } from "../../src/worker/stored-state";
import { connectGuest, connectHost, createSession, newSessionId, quiz } from "./helpers";

// 動いているインスタンスはストレージを constructor で一度しか読まない。テストが書いた内容で
// 同じ読み込みをやり直し、その結果を動いているインスタンスに渡して、ソケットから見えるようにする。
const reloadFrom = async (id: string, write: (kv: SyncKvStorage) => void) => {
  const stub = env.SESSION_ROOM.getByName(id);
  await runInDurableObject(stub, async (inst, ctx) => {
    write(ctx.storage.kv);
    const fresh = new SessionRoom(ctx, env) as unknown as { state: unknown };
    (inst as unknown as { state: unknown }).state = fresh.state;
  });
};

describe("stored state version", () => {
  it("writes the current version when a session is created", async () => {
    const id = newSessionId();
    await createSession(id);
    await runInDurableObject(env.SESSION_ROOM.getByName(id), async (_inst, ctx) => {
      expect(ctx.storage.kv.get(STATE_VERSION_KEY)).toBe(STATE_SCHEMA_VERSION);
    });
  });

  it("runs a session stored before versioning, with optional fields missing", async () => {
    const id = newSessionId();
    await createSession(id);
    await reloadFrom(id, (kv) => {
      kv.delete(STATE_VERSION_KEY);
      const questions = quiz.questions.map(({ imageUrl: _omit, ...q }) => q);
      kv.put("state", {
        quiz: { title: quiz.title, questions },
        phase: { type: "lobby" },
        players: [{ id: "p1", token: "tok-1", nickname: "Old" }],
      });
    });
    const guest = await connectGuest(id, "tok-1");
    expect((await guest.next("guest_view")).view).toMatchObject({ kind: "lobby", nickname: "Old" });
    const host = await connectHost(id);
    host.send({ type: "advance", from: "lobby" });
    const view = await guest.next("guest_view", (m) => m.view.kind === "question");
    expect(view.view).toMatchObject({ kind: "question", question: { imageUrl: null } });
  });

  it("logs a shape mismatch and keeps the stored state untouched", async () => {
    const id = newSessionId();
    await createSession(id);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      quiz: { title: quiz.title, questions: quiz.questions },
      phase: { type: "lobby" },
      players: [{ id: "p1", token: "tok-1", nickname: 7, answers: {} }],
    };
    try {
      await reloadFrom(id, (kv) => kv.put("state", broken));
      const lines = errors.mock.calls.map(([line]) => JSON.parse(String(line)));
      expect(lines).toContainEqual(
        expect.objectContaining({ level: "error", event: "state_schema_mismatch", sessionId: id, issueCount: 1 }),
      );
    } finally {
      errors.mockRestore();
    }
    await runInDurableObject(env.SESSION_ROOM.getByName(id), async (_inst, ctx) => {
      expect(ctx.storage.kv.get("state")).toEqual(broken);
    });
    const host = await connectHost(id);
    expect((await host.next("host_view")).view.phaseKey).toBe("lobby");
  });
});

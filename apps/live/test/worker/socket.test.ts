import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { SessionRoom } from "../../src/worker/session-room";
import { connectGuest, connectHost, createSession, newSessionId, rankingOf } from "./helpers";

async function setup() {
  const id = newSessionId();
  await createSession(id);
  const host = await connectHost(id);
  await host.next("host_view");
  return { id, host };
}

async function joinGuest(id: string, nickname: string) {
  const guest = await connectGuest(id);
  await guest.next("need_join");
  guest.send({ type: "join", nickname });
  const joined = await guest.next("joined");
  await guest.next("guest_view");
  return { guest, token: joined.playerToken };
}

describe("SessionRoom heartbeat", () => {
  it("answers a raw ping with pong and the socket keeps working", async () => {
    const { id } = await setup();
    const res = await exports.default.fetch(`https://x/ws/${id}/guest`, { headers: { Upgrade: "websocket" } });
    const ws = res.webSocket!;
    const frames: string[] = [];
    ws.addEventListener("message", (e) => void frames.push(e.data as string));
    ws.accept();
    ws.send("ping");
    const deadline = Date.now() + 3000;
    while (!frames.includes("pong") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    expect(frames).toContain("pong");
    // still serves normal messages afterwards
    ws.send(JSON.stringify({ type: "join", nickname: "Hana" }));
    while (!frames.some((f) => f.includes('"joined"')) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    expect(frames.some((f) => f.includes('"joined"'))).toBe(true);
  });
});

describe("SessionRoom sockets", () => {
  it("guest join yields joined + lobby guest_view; host sees playerCount 1", async () => {
    const { id, host } = await setup();
    const guest = await connectGuest(id);
    await guest.next("need_join");
    guest.send({ type: "join", nickname: "Taro" });
    const joined = await guest.next("joined");
    expect(joined.playerToken).toBeTruthy();
    const gv = await guest.next("guest_view");
    expect(gv.view).toEqual({ kind: "lobby", title: "Test Quiz", nickname: "Taro" });
    const hv = await host.next("host_view", (m) => m.view.playerCount === 1);
    expect(hv.view.screen.kind).toBe("lobby");
  });

  it("duplicate nickname yields join_error", async () => {
    const { id } = await setup();
    await joinGuest(id, "Taro");
    const g2 = await connectGuest(id);
    await g2.next("need_join");
    g2.send({ type: "join", nickname: " Taro " });
    const err = await g2.next("join_error");
    expect(err.reason).toBe("nickname_taken");
  });

  it("host advance from lobby sends question view to guest", async () => {
    const { id, host } = await setup();
    const { guest } = await joinGuest(id, "Taro");
    host.send({ type: "advance", from: "lobby" });
    const gv = await guest.next("guest_view", (m) => m.view.kind === "question");
    expect(gv.view).toMatchObject({ kind: "question", status: "open", myChoice: null });
    await host.next("host_view", (m) => m.view.screen.kind === "question");
  });

  it("advance twice with the same from only moves once", async () => {
    const { id, host } = await setup();
    host.send({ type: "advance", from: "lobby" });
    host.send({ type: "advance", from: "lobby" });
    await host.next("host_view", (m) => m.view.screen.kind === "question");
    await new Promise((r) => setTimeout(r, 100));
    expect((await rankingOf(id)).body.phaseKey).toBe("q:0:open");
  });

  it("advance from a guest is ignored", async () => {
    const { id } = await setup();
    const { guest } = await joinGuest(id, "Taro");
    guest.send({ type: "advance", from: "lobby" });
    await new Promise((r) => setTimeout(r, 100));
    expect((await rankingOf(id)).body.phaseKey).toBe("lobby");
  });

  it("answer reaches the player and the host; scores are tracked", async () => {
    const { id, host } = await setup();
    const { guest } = await joinGuest(id, "Taro");
    host.send({ type: "advance", from: "lobby" });
    await guest.next("guest_view", (m) => m.view.kind === "question");
    guest.send({ type: "answer", questionIndex: 0, choice: 1 });
    await guest.next("guest_view", (m) => m.view.kind === "question" && m.view.myChoice === 1);
    await host.next("host_view", (m) => m.view.screen.kind === "question" && m.view.screen.answeredCount === 1);
  });

  it("malformed JSON and unknown types are ignored without closing", async () => {
    const { id } = await setup();
    const { guest } = await joinGuest(id, "Taro");
    guest.send("{nope");
    guest.send({ type: "bogus" });
    guest.send({ type: "join", nickname: "Again" }); // already joined: ignored
    await new Promise((r) => setTimeout(r, 100));
    expect(guest.ws.readyState).toBe(WebSocket.OPEN);
    expect((await rankingOf(id)).body.players).toHaveLength(1);
  });

  it("unknown playerToken yields need_join", async () => {
    const { id } = await setup();
    const g = await connectGuest(id, "garbage");
    await g.next("need_join");
    g.send({ type: "join", nickname: "Late" });
    await g.next("joined");
  });

  it("reconnect with saved token restores nickname and score", async () => {
    const { id, host } = await setup();
    const { guest, token } = await joinGuest(id, "Taro");
    host.send({ type: "advance", from: "lobby" });
    await guest.next("guest_view", (m) => m.view.kind === "question");
    guest.send({ type: "answer", questionIndex: 0, choice: 1 });
    await host.next("host_view", (m) => m.view.screen.kind === "question" && m.view.screen.answeredCount === 1);
    host.send({ type: "advance", from: "q:0:open" });
    await host.next("host_view", (m) => m.view.phaseKey === "q:0:closed");
    host.send({ type: "advance", from: "q:0:closed" });
    await host.next("host_view", (m) => m.view.screen.kind === "reveal");
    guest.ws.close();
    const g2 = await connectGuest(id, token);
    const gv = await g2.next("guest_view");
    expect(gv.view).toMatchObject({ kind: "reveal", correct: true, score: 10, myChoice: 1 });
    const r = await rankingOf(id);
    expect(r.body.players[0]).toMatchObject({ nickname: "Taro", score: 10 });
  });

  it("state survives re-creating the Durable Object", async () => {
    const { id, host } = await setup();
    await joinGuest(id, "Taro");
    host.send({ type: "advance", from: "lobby" });
    await host.next("host_view", (m) => m.view.screen.kind === "question");
    const stub = env.SESSION_ROOM.getByName(id);
    const before = await stub.ranking();
    await runInDurableObject(stub, async (_inst, ctx) => {
      const saved = ctx.storage.kv.get("state") as any;
      expect(saved.phase).toEqual({ type: "question", index: 0, status: "open" });
      const fresh = new SessionRoom(ctx, env);
      expect(await fresh.ranking()).toEqual(before);
    });
  });
});

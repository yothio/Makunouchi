import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { MAX_MESSAGE_BYTES, MAX_WEBSOCKETS } from "@worker/game/rules";
import { connectExpectingClose, connectGuest, connectHost, createSession, newSessionId } from "./helpers";
import { exports } from "cloudflare:workers";

type Spies = { log: MockInstance; warn: MockInstance; error: MockInstance };

let spies: Spies;

beforeEach(() => {
  spies = {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

const linesOf = (spy: MockInstance): Record<string, unknown>[] =>
  spy.mock.calls.flatMap(([first]) => {
    if (typeof first !== "string") return [];
    try {
      return [JSON.parse(first) as Record<string, unknown>];
    } catch {
      return [];
    }
  });

const waitForLine = async (
  spy: MockInstance,
  pred: (line: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> => {
  const deadline = Date.now() + 3000;
  for (;;) {
    const found = linesOf(spy).find(pred);
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`log line not found; got ${JSON.stringify(spy.mock.calls)}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe("structured logs from SessionRoom", () => {
  it("logs a guest rejected at the connection cap", async () => {
    const id = newSessionId();
    await createSession(id);
    await connectHost(id);
    await Promise.all(Array.from({ length: MAX_WEBSOCKETS - 1 }, () => connectGuest(id)));

    const rejected = await exports.default.fetch(`https://x/ws/${id}/guest`, { headers: { Upgrade: "websocket" } });
    expect(rejected.status).toBe(503);

    const line = await waitForLine(spies.warn, (l) => l.event === "ws_rejected_capacity");
    expect(line).toMatchObject({ level: "warn", sessionId: id, role: "guest", activeSockets: MAX_WEBSOCKETS });
  });

  it("logs a connection to a session that was never created", async () => {
    const id = newSessionId();
    const { code } = await connectExpectingClose(`/ws/${id}/guest`);
    expect(code).toBe(4404);

    const line = await waitForLine(spies.warn, (l) => l.event === "ws_rejected_session_not_found");
    expect(line).toMatchObject({ level: "warn", sessionId: id, role: "guest" });
  });

  it("logs an oversized message with its size but not its content", async () => {
    const id = newSessionId();
    await createSession(id);
    const guest = await connectGuest(id);
    await guest.next("need_join");

    guest.send(JSON.stringify({ type: "join", nickname: "x".repeat(MAX_MESSAGE_BYTES) }));

    const line = await waitForLine(spies.warn, (l) => l.event === "ws_message_too_large");
    expect(line).toMatchObject({ level: "warn", sessionId: id, role: "guest" });
    expect(line.bytes).toBeGreaterThan(MAX_MESSAGE_BYTES);
    expect(JSON.stringify(line)).not.toContain("xxxx");
  });

  it("logs an unparseable message without echoing it", async () => {
    const id = newSessionId();
    await createSession(id);
    const guest = await connectGuest(id);
    await guest.next("need_join");

    guest.send("not json: secret-nickname");

    const line = await waitForLine(spies.warn, (l) => l.event === "ws_message_invalid");
    expect(line).toMatchObject({ level: "warn", sessionId: id, role: "guest", reason: "unparseable" });
    expect(JSON.stringify(line)).not.toContain("secret-nickname");
  });

  it("logs a stale advance as a rejected transition and a valid one as a phase change", async () => {
    const id = newSessionId();
    await createSession(id);
    const host = await connectHost(id);
    await host.next("host_view");

    host.send({ type: "advance", from: "lobby" });
    await host.next("host_view", (m) => m.view.phaseKey === "q:0:open");
    host.send({ type: "advance", from: "lobby" });

    const rejected = await waitForLine(spies.warn, (l) => l.event === "transition_rejected");
    expect(rejected).toMatchObject({
      level: "warn",
      sessionId: id,
      role: "host",
      action: "advance",
      from: "lobby",
      current: "q:0:open",
      reason: "stale_phase",
    });
    const changed = await waitForLine(spies.log, (l) => l.event === "phase_changed");
    expect(changed).toMatchObject({ level: "info", sessionId: id, action: "advance", from: "lobby", to: "q:0:open" });
  });

  it("does not log accepted or rejected answers", async () => {
    const id = newSessionId();
    await createSession(id);
    const host = await connectHost(id);
    await host.next("host_view");
    const guest = await connectGuest(id);
    await guest.next("need_join");
    guest.send({ type: "join", nickname: "alice" });
    await guest.next("joined");

    host.send({ type: "advance", from: "lobby" });
    await host.next("host_view", (m) => m.view.phaseKey === "q:0:open");
    guest.send({ type: "answer", questionIndex: 0, choice: 1 });
    await host.next("host_view", (m) => m.view.screen.kind === "question" && m.view.screen.answeredCount === 1);
    guest.send({ type: "answer", questionIndex: 3, choice: 1 });
    host.send({ type: "advance", from: "q:0:open" });
    await host.next("host_view", (m) => m.view.phaseKey === "q:0:closed");

    const all = [...linesOf(spies.log), ...linesOf(spies.warn), ...linesOf(spies.error)];
    expect(all.map((l) => l.event)).toEqual(["phase_changed", "phase_changed"]);
  });
});

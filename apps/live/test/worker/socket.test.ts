import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { SessionRoom } from "../../src/worker/session-room";
import { screenTokenFor } from "../../src/worker/auth";
import { connectGuest, connectHost, connectScreen, createSession, newSessionId, rankingOf } from "./helpers";

const setup = async () => {
  const id = newSessionId();
  await createSession(id);
  const host = await connectHost(id);
  await host.next("host_view");
  return { id, host };
};

const joinGuest = async (id: string, nickname: string) => {
  const guest = await connectGuest(id);
  await guest.next("need_join");
  guest.send({ type: "join", nickname });
  const joined = await guest.next("joined");
  await guest.next("guest_view");
  return { guest, token: joined.playerToken };
};

describe("role forwarding", () => {
  it("ignores a client-supplied role header on a guest URL", async () => {
    const { id, host } = await setup();
    const res = await exports.default.fetch(`https://x/ws/${id}/guest`, {
      headers: { Upgrade: "websocket", "X-Makunouchi-Role": "host" },
    });
    const ws = res.webSocket!;
    const frames: string[] = [];
    ws.addEventListener("message", (e) => void frames.push(e.data as string));
    ws.accept();
    const deadline = Date.now() + 3000;
    while (frames.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    expect(JSON.parse(frames[0]).type).toBe("need_join");
    // a guest cannot advance the game even though it sent a host header
    ws.send(JSON.stringify({ type: "advance", from: "lobby" }));
    await new Promise((r) => setTimeout(r, 200));
    expect(host.messages.filter((m) => m.type === "host_view")).toHaveLength(1);
  });

  it("ignores a client-supplied role header on a screen URL", async () => {
    const { id } = await setup();
    const token = await screenTokenFor(env.ADMIN_API_SECRET, id);
    const res = await exports.default.fetch(`https://x/ws/${id}/screen?token=${token}`, {
      headers: { Upgrade: "websocket", "X-Makunouchi-Role": "host" },
    });
    const ws = res.webSocket!;
    const frames: string[] = [];
    ws.addEventListener("message", (e) => void frames.push(e.data as string));
    ws.accept();
    const deadline = Date.now() + 3000;
    while (frames.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    expect(JSON.parse(frames[0]).type).toBe("screen_view");
  });

  it("rejects a request reaching the room without a role", async () => {
    const { id } = await setup();
    const room = env.SESSION_ROOM.getByName(id, { locationHint: "apac-ne" });
    const res = await room.fetch(`https://x/ws/${id}/host`, { headers: { Upgrade: "websocket" } });
    expect(res.status).toBe(400);
  });
});

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
    expect(gv.view).toMatchObject({ kind: "reveal", correct: true, score: 1, myChoice: 1 });
    const r = await rankingOf(id);
    expect(r.body.players[0]).toMatchObject({ nickname: "Taro", score: 1 });
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

describe("SessionRoom screen", () => {
  const settle = () => new Promise((r) => setTimeout(r, 150));

  it("sends the current screen_view right after connecting (lobby with playerCount)", async () => {
    const { id } = await setup();
    await joinGuest(id, "Taro");
    const screen = await connectScreen(id);
    const sv = await screen.next("screen_view");
    expect(sv.view).toEqual({ kind: "lobby", title: "Test Quiz", playerCount: 1 });
  });

  it("ignores advance from a screen", async () => {
    const { id, host } = await setup();
    const screen = await connectScreen(id);
    await screen.next("screen_view");
    screen.send({ type: "advance", from: "lobby" });
    await settle();
    expect((await rankingOf(id)).body.phaseKey).toBe("lobby");
    expect(host.messages.filter((m) => m.type === "host_view")).toHaveLength(1);
  });

  it("host advance sends a question screen_view without correctIndex; the screen never gets host_view", async () => {
    const { id, host } = await setup();
    const screen = await connectScreen(id);
    await screen.next("screen_view");
    host.send({ type: "advance", from: "lobby" });
    const sv = await screen.next("screen_view", (m) => m.view.kind === "question");
    expect(sv.view).toMatchObject({ kind: "question", status: "open" });
    expect(JSON.stringify(sv)).not.toContain("correctIndex");
    host.send({ type: "advance", from: "q:0:open" });
    const closed = await screen.next("screen_view", (m) => m.view.kind === "question" && m.view.status === "closed");
    expect(JSON.stringify(closed)).not.toContain("correctIndex");
    host.send({ type: "advance", from: "q:0:closed" });
    await screen.next("screen_view", (m) => m.view.kind === "reveal");
    expect(screen.messages.every((m) => m.type === "screen_view")).toBe(true);
  });

  it("an answer reaches the host but sends nothing to the screen", async () => {
    const { id, host } = await setup();
    const { guest } = await joinGuest(id, "Taro");
    const screen = await connectScreen(id);
    await screen.next("screen_view");
    host.send({ type: "advance", from: "lobby" });
    await screen.next("screen_view", (m) => m.view.kind === "question");
    const before = screen.messages.length;
    guest.send({ type: "answer", questionIndex: 0, choice: 1 });
    await host.next("host_view", (m) => m.view.screen.kind === "question" && m.view.screen.answeredCount === 1);
    await settle();
    expect(screen.messages.length).toBe(before);
  });

  it("a join during the lobby updates the screen; a join after the start does not", async () => {
    const { id, host } = await setup();
    const screen = await connectScreen(id);
    await screen.next("screen_view");
    await joinGuest(id, "Taro");
    await screen.next("screen_view", (m) => m.view.kind === "lobby" && m.view.playerCount === 1);
    host.send({ type: "advance", from: "lobby" });
    await screen.next("screen_view", (m) => m.view.kind === "question");
    const before = screen.messages.length;
    await joinGuest(id, "Hana");
    await settle();
    expect(screen.messages.length).toBe(before);
  });

  it("two screens receive the same views", async () => {
    const { id, host } = await setup();
    const a = await connectScreen(id);
    const b = await connectScreen(id);
    host.send({ type: "advance", from: "lobby" });
    const va = await a.next("screen_view", (m) => m.view.kind === "question");
    const vb = await b.next("screen_view", (m) => m.view.kind === "question");
    expect(vb.view).toEqual(va.view);
  });

  it("a screen opened mid-question gets that stage immediately", async () => {
    const { id, host } = await setup();
    host.send({ type: "advance", from: "lobby" });
    host.send({ type: "advance", from: "q:0:open" });
    host.send({ type: "advance", from: "q:0:closed" });
    host.send({ type: "advance", from: "q:0:revealed" });
    host.send({ type: "advance", from: "q:1:open" });
    await host.next("host_view", (m) => m.view.phaseKey === "q:1:closed");
    const screen = await connectScreen(id);
    const sv = await screen.next("screen_view");
    expect(sv.view).toMatchObject({ kind: "question", status: "closed", question: { index: 1 } });
    expect(JSON.stringify(sv)).not.toContain("correctIndex");
  });

  it("a new screen after re-creating the Durable Object gets the same view", async () => {
    const { id, host } = await setup();
    host.send({ type: "advance", from: "lobby" });
    await host.next("host_view", (m) => m.view.screen.kind === "question");
    const first = await connectScreen(id);
    const before = await first.next("screen_view");
    const stub = env.SESSION_ROOM.getByName(id);
    await runInDurableObject(stub, async (_inst, ctx) => {
      const fresh = new SessionRoom(ctx, env);
      expect(await fresh.ranking()).toMatchObject({ phaseKey: "q:0:open" });
    });
    const second = await connectScreen(id);
    expect((await second.next("screen_view")).view).toEqual(before.view);
  });
});

import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { SessionRoom } from "../../src/worker/session-room";
import { screenTokenFor } from "../../src/worker/auth";
import { MAX_MESSAGE_BYTES, MAX_PLAYERS, MAX_WEBSOCKETS } from "../../src/worker/game/rules";
import {
  connectGuest,
  connectHost,
  connectScreen,
  createSession,
  driveToResults,
  findLast,
  newSessionId,
  rankingOf,
} from "./helpers";

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
    guest.send({ type: "join", nickname: "Again" });
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

  it("join_error full when roster is at MAX_PLAYERS; token reconnect still works", async () => {
    const { id } = await setup();
    const { guest, token } = await joinGuest(id, "First");
    const stub = env.SESSION_ROOM.getByName(id);
    await runInDurableObject(stub, async (inst, ctx) => {
      const room = inst as unknown as {
        state: {
          quiz: unknown;
          phase: unknown;
          players: { id: string; token: string; nickname: string; answers: Record<string, never> }[];
        } | null;
      };
      const state = room.state!;
      const players = [{ id: state.players[0].id, token, nickname: "First", answers: {} }];
      for (let i = 1; i < MAX_PLAYERS; i++) {
        players.push({ id: `id${i}`, token: `t${i}`, nickname: `n${i}`, answers: {} });
      }
      const next = { ...state, players };
      room.state = next;
      ctx.storage.kv.put("state", next);
    });
    const late = await connectGuest(id);
    await late.next("need_join");
    late.send({ type: "join", nickname: "Overflow" });
    const err = await late.next("join_error");
    expect(err.reason).toBe("full");
    guest.ws.close();
    const again = await connectGuest(id, token);
    const gv = await again.next("guest_view");
    expect(gv.view).toMatchObject({ kind: "lobby", nickname: "First" });
  });

  it("oversized inbound message is dropped and the sender is closed", async () => {
    const { id } = await setup();
    const { guest } = await joinGuest(id, "Taro");
    guest.ws.send("x".repeat(MAX_MESSAGE_BYTES + 1));
    const deadline = Date.now() + 3000;
    while (guest.ws.readyState === WebSocket.OPEN && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(guest.ws.readyState).not.toBe(WebSocket.OPEN);
    expect((await rankingOf(id)).body.players).toHaveLength(1);
  });

  it("oversized ArrayBuffer frame closes the sender without changing state", async () => {
    const { id } = await setup();
    const { guest } = await joinGuest(id, "Taro");
    guest.ws.send(new ArrayBuffer(MAX_MESSAGE_BYTES + 1));
    const deadline = Date.now() + 3000;
    while (guest.ws.readyState === WebSocket.OPEN && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(guest.ws.readyState).not.toBe(WebSocket.OPEN);
    expect((await rankingOf(id)).body.players).toHaveLength(1);
  });
});

describe("SessionRoom connection caps", () => {
  it("rejects guest upgrade with 503 at MAX_WEBSOCKETS but still accepts host and screen", async () => {
    const { id, host } = await setup();
    const guests = await Promise.all(
      Array.from({ length: MAX_WEBSOCKETS - 1 }, () => connectGuest(id)),
    );
    const rejected = await exports.default.fetch(`https://x/ws/${id}/guest`, {
      headers: { Upgrade: "websocket" },
    });
    expect(rejected.status).toBe(503);
    expect(rejected.webSocket).toBeNull();

    const screen = await connectScreen(id);
    await screen.next("screen_view");
    expect(screen.ws.readyState).toBe(WebSocket.OPEN);

    host.ws.close();
    const host2 = await connectHost(id);
    await host2.next("host_view");
    expect(host2.ws.readyState).toBe(WebSocket.OPEN);

    screen.ws.close();
    guests.forEach((g) => g.ws.close());
    host2.ws.close();
  }, 60_000);

  it("after a guest at the cap closes, a new guest can connect again", async () => {
    const { id, host } = await setup();
    const guests = await Promise.all(
      Array.from({ length: MAX_WEBSOCKETS - 1 }, () => connectGuest(id)),
    );
    const rejected = await exports.default.fetch(`https://x/ws/${id}/guest`, {
      headers: { Upgrade: "websocket" },
    });
    expect(rejected.status).toBe(503);

    guests[0]!.ws.close();
    const deadline = Date.now() + 3000;
    while (guests[0]!.ws.readyState !== WebSocket.CLOSED && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }

    const again = await connectGuest(id);
    await again.next("need_join");
    expect(again.ws.readyState).toBe(WebSocket.OPEN);

    again.ws.close();
    guests.forEach((g) => g.ws.close());
    host.ws.close();
  }, 60_000);
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

  it("ignores join and answer sent from a screen", async () => {
    const { id, host } = await setup();
    const screen = await connectScreen(id);
    await screen.next("screen_view");
    screen.send({ type: "join", nickname: "Sneaky" });
    host.send({ type: "advance", from: "lobby" });
    await host.next("host_view", (m) => m.view.phaseKey === "q:0:open");
    screen.send({ type: "answer", questionIndex: 0, choice: 1 });
    await settle();
    const ranking = (await rankingOf(id)).body;
    expect(ranking.players).toHaveLength(0);
    const hostView = host.messages.filter((m) => m.type === "host_view").at(-1);
    expect(hostView?.type === "host_view" && hostView.view.playerCount).toBe(0);
    expect(hostView?.type === "host_view" && hostView.view.screen).toMatchObject({ kind: "question", answeredCount: 0 });
    expect(screen.ws.readyState).toBe(WebSocket.OPEN);
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

describe("SessionRoom answer history", () => {
  const advanceTo = async (host: Awaited<ReturnType<typeof setup>>["host"], steps: [from: string, to: string][]) => {
    for (const [from, to] of steps) {
      host.send({ type: "advance", from });
      await host.next("host_view", (m) => m.view.phaseKey === to);
    }
  };

  it("sends the player's history after the reveal, and restores it on reconnect", async () => {
    const { id, host } = await setup();
    const { guest, token } = await joinGuest(id, "Taro");
    await advanceTo(host, [["lobby", "q:0:open"]]);
    guest.send({ type: "answer", questionIndex: 0, choice: 1 });
    await guest.next("guest_view", (m) => m.view.kind === "question" && m.view.myChoice === 1);
    await advanceTo(host, [["q:0:open", "q:0:closed"]]);
    const closed = await guest.next("guest_view", (m) => m.view.kind === "question" && m.view.status === "closed");
    expect(closed.view).toMatchObject({ history: [] });
    await advanceTo(host, [["q:0:closed", "q:0:revealed"]]);
    const revealed = await guest.next("guest_view", (m) => m.view.kind === "reveal");
    expect(revealed.view).toMatchObject({ history: [{ index: 0, choice: 1, correct: true }] });

    guest.ws.close();
    const again = await connectGuest(id, token);
    const restored = await again.next("guest_view");
    expect(restored.view).toMatchObject({ kind: "reveal", history: [{ index: 0, choice: 1, correct: true }] });
  });

  it("shows only earlier questions while the next question is open", async () => {
    const { id, host } = await setup();
    const { guest } = await joinGuest(id, "Taro");
    await advanceTo(host, [
      ["lobby", "q:0:open"],
      ["q:0:open", "q:0:closed"],
      ["q:0:closed", "q:0:revealed"],
      ["q:0:revealed", "q:1:open"],
    ]);
    const open = await guest.next("guest_view", (m) => m.view.kind === "question" && m.view.question.index === 1);
    expect(open.view).toMatchObject({ status: "open", history: [{ index: 0, choice: null, correct: false }] });
  });

  it("a late joiner sees the questions before joining as unanswered", async () => {
    const { id, host } = await setup();
    await advanceTo(host, [
      ["lobby", "q:0:open"],
      ["q:0:open", "q:0:closed"],
      ["q:0:closed", "q:0:revealed"],
      ["q:0:revealed", "q:1:open"],
    ]);
    const late = await connectGuest(id);
    await late.next("need_join");
    late.send({ type: "join", nickname: "Late" });
    await late.next("joined");
    const view = await late.next("guest_view");
    expect(view.view).toMatchObject({ kind: "question", history: [{ index: 0, choice: null, correct: false }] });
  });

  it("never sends a rank to a participant, even at the end of the results", async () => {
    const { id, host } = await setup();
    const { guest } = await joinGuest(id, "Taro");
    await driveToResults(host, id);
    const pending = await guest.next("guest_view", (m) => m.view.kind === "results_pending");
    expect(pending.view).toMatchObject({ history: expect.any(Array) });
    expect(JSON.stringify(guest.messages)).not.toContain('"rank"');
  });
});

describe("SessionRoom free-order results", () => {
  const lastRanking = (host: Awaited<ReturnType<typeof setup>>["host"]) => {
    const ranking = findLast(
      host.messages,
      (m) => m.type === "host_view" && m.view.screen.kind === "ranking",
    );
    if (!ranking || ranking.type !== "host_view" || ranking.view.screen.kind !== "ranking") {
      throw new Error("no ranking host_view");
    }
    return ranking.view.screen;
  };

  it("結果フェーズに入ると幹事は ranking、投影は results_wait、参列者は results_pending", async () => {
    const { id, host } = await setup();
    const screen = await connectScreen(id);
    await screen.next("screen_view");
    const { guest } = await joinGuest(id, "Taro");
    await driveToResults(host, id);
    expect(lastRanking(host).kind).toBe("ranking");
    const lastScreen = findLast(screen.messages, (m) => m.type === "screen_view");
    expect(lastScreen && lastScreen.type === "screen_view" ? lastScreen.view : null).toMatchObject({
      kind: "results_wait",
    });
    const lastGuest = findLast(guest.messages, (m) => m.type === "guest_view");
    expect(lastGuest && lastGuest.type === "guest_view" ? lastGuest.view : null).toMatchObject({
      kind: "results_pending",
    });
  });

  it("select で幹事は ranking_detail、投影は results_wait。参列者には届かない", async () => {
    const { id, host } = await setup();
    const screen = await connectScreen(id);
    await screen.next("screen_view");
    const { guest } = await joinGuest(id, "Taro");
    await driveToResults(host, id);
    await guest.next("guest_view", (m) => m.view.kind === "results_pending");
    await screen.next("screen_view", (m) => m.view.kind === "results_wait");
    const guestCount = guest.messages.length;
    const screenCount = screen.messages.length;
    const playerId = lastRanking(host).entries[0].playerId;
    host.send({ type: "results_action", from: "r:list", action: { kind: "select", playerId } });
    const detail = await host.next("host_view", (m) => m.view.screen.kind === "ranking_detail");
    expect(detail.view.screen).toMatchObject({ kind: "ranking_detail", playerId, rankShown: false, nameShown: false });
    await screen.next("screen_view", (m) => m.view.kind === "results_wait");
    expect(screen.messages.length).toBeGreaterThan(screenCount);
    await new Promise((r) => setTimeout(r, 100));
    expect(guest.messages.length).toBe(guestCount);
  });

  it("show_rank のあと show_name で両方入り、back で一覧に戻る", async () => {
    const { id, host } = await setup();
    const screen = await connectScreen(id);
    await screen.next("screen_view");
    const { guest } = await joinGuest(id, "Taro");
    await driveToResults(host, id);
    await screen.next("screen_view", (m) => m.view.kind === "results_wait");
    const playerId = lastRanking(host).entries[0].playerId;
    host.send({ type: "results_action", from: "r:list", action: { kind: "select", playerId } });
    await host.next("host_view", (m) => m.view.screen.kind === "ranking_detail");
    await screen.next("screen_view", (m) => m.view.kind === "results_wait");
    host.send({ type: "results_action", from: `r:${playerId}:hidden`, action: { kind: "show_rank" } });
    const rankOnly = await screen.next("screen_view", (m) => m.view.kind === "rank_reveal");
    expect(rankOnly.view).toEqual({ kind: "rank_reveal", rank: 1, nickname: null });
    await host.next("host_view", (m) => m.view.phaseKey === `r:${playerId}:rank`);
    host.send({ type: "results_action", from: `r:${playerId}:rank`, action: { kind: "show_name" } });
    const both = await screen.next("screen_view", (m) => m.view.kind === "rank_reveal" && m.view.nickname !== null);
    expect(both.view).toMatchObject({ kind: "rank_reveal", rank: 1, nickname: "Taro" });
    host.send({ type: "results_action", from: `r:${playerId}:both`, action: { kind: "back" } });
    await host.next("host_view", (m) => m.view.screen.kind === "ranking");
    await screen.next("screen_view", (m) => m.view.kind === "results_wait");
    expect(guest.messages.filter((m) => m.type === "guest_view" && m.view.kind === "results_pending").length).toBe(1);
  });

  it("同じ from の select を 2 回送っても 1 回ぶんだけ変わる", async () => {
    const { id, host } = await setup();
    await joinGuest(id, "A");
    await joinGuest(id, "B");
    await driveToResults(host, id);
    const entries = lastRanking(host).entries;
    const a = entries.find((e: { nickname: string }) => e.nickname === "A")!.playerId;
    const b = entries.find((e: { nickname: string }) => e.nickname === "B")!.playerId;
    host.send({ type: "results_action", from: "r:list", action: { kind: "select", playerId: a } });
    host.send({ type: "results_action", from: "r:list", action: { kind: "select", playerId: b } });
    const detail = await host.next("host_view", (m) => m.view.screen.kind === "ranking_detail");
    expect(detail.view.screen).toMatchObject({ kind: "ranking_detail", playerId: a });
    await new Promise((r) => setTimeout(r, 100));
    expect(host.messages.filter((m) => m.type === "host_view" && m.view.screen.kind === "ranking_detail")).toHaveLength(1);
    const rank = await rankingOf(id);
    expect(rank.body.phaseKey).toBe(`r:${a}:hidden`);
  });

  it("show_rank 直後に古い from の show_name は無視され rank のまま", async () => {
    const { id, host } = await setup();
    await joinGuest(id, "Taro");
    await driveToResults(host, id);
    const playerId = lastRanking(host).entries[0].playerId;
    host.send({ type: "results_action", from: "r:list", action: { kind: "select", playerId } });
    await host.next("host_view", (m) => m.view.phaseKey === `r:${playerId}:hidden`);
    host.send({ type: "results_action", from: `r:${playerId}:hidden`, action: { kind: "show_rank" } });
    host.send({ type: "results_action", from: `r:${playerId}:hidden`, action: { kind: "show_name" } });
    await host.next("host_view", (m) => m.view.phaseKey === `r:${playerId}:rank`);
    await new Promise((r) => setTimeout(r, 100));
    expect((await rankingOf(id)).body.phaseKey).toBe(`r:${playerId}:rank`);
  });

  it("別の幹事タブ 2 つが同じ from から別々の人を選ぶと片方だけ選ばれる", async () => {
    const { id, host } = await setup();
    const host2 = await connectHost(id);
    await host2.next("host_view");
    await joinGuest(id, "A");
    await joinGuest(id, "B");
    await driveToResults(host, id);
    await host2.next("host_view", (m) => m.view.phaseKey === "r:list");
    const entries = lastRanking(host).entries;
    const a = entries.find((e: { nickname: string }) => e.nickname === "A")!.playerId;
    const b = entries.find((e: { nickname: string }) => e.nickname === "B")!.playerId;
    host.send({ type: "results_action", from: "r:list", action: { kind: "select", playerId: a } });
    host2.send({ type: "results_action", from: "r:list", action: { kind: "select", playerId: b } });
    await host.next("host_view", (m) => m.view.screen.kind === "ranking_detail");
    await new Promise((r) => setTimeout(r, 100));
    const key = (await rankingOf(id)).body.phaseKey as string;
    expect([`r:${a}:hidden`, `r:${b}:hidden`]).toContain(key);
  });

  it("投影画面・参列者が送った results_action は無視される", async () => {
    const { id, host } = await setup();
    const screen = await connectScreen(id);
    await screen.next("screen_view");
    const { guest } = await joinGuest(id, "Taro");
    await driveToResults(host, id);
    const before = (await rankingOf(id)).body.phaseKey;
    screen.send({ type: "results_action", from: "r:list", action: { kind: "select", playerId: "x" } });
    guest.send({ type: "results_action", from: "r:list", action: { kind: "select", playerId: "x" } });
    await new Promise((r) => setTimeout(r, 100));
    expect((await rankingOf(id)).body.phaseKey).toBe(before);
  });

  it("results 以外での results_action は無視される", async () => {
    const { id, host } = await setup();
    await joinGuest(id, "Taro");
    host.send({ type: "advance", from: "lobby" });
    await host.next("host_view", (m) => m.view.phaseKey === "q:0:open");
    host.send({ type: "results_action", from: "q:0:open", action: { kind: "select", playerId: "x" } });
    await new Promise((r) => setTimeout(r, 100));
    expect((await rankingOf(id)).body.phaseKey).toBe("q:0:open");
  });

  it("存在しない playerId の select で幹事に何も届かず接続も閉じない", async () => {
    const { id, host } = await setup();
    await joinGuest(id, "Taro");
    await driveToResults(host, id);
    const before = host.messages.length;
    host.send({ type: "results_action", from: "r:list", action: { kind: "select", playerId: "nobody" } });
    await new Promise((r) => setTimeout(r, 100));
    expect(host.messages.length).toBe(before);
    expect(host.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("再読み込みと DO 再作成でも選択と投影が復元される", async () => {
    const { id, host } = await setup();
    const screen = await connectScreen(id);
    await screen.next("screen_view");
    await joinGuest(id, "Taro");
    await driveToResults(host, id);
    const playerId = lastRanking(host).entries[0].playerId;
    host.send({ type: "results_action", from: "r:list", action: { kind: "select", playerId } });
    await host.next("host_view", (m) => m.view.phaseKey === `r:${playerId}:hidden`);
    host.send({ type: "results_action", from: `r:${playerId}:hidden`, action: { kind: "show_rank" } });
    await host.next("host_view", (m) => m.view.phaseKey === `r:${playerId}:rank`);
    host.ws.close();
    screen.ws.close();
    const host2 = await connectHost(id);
    const restoredHost = await host2.next("host_view");
    expect(restoredHost.view.screen).toMatchObject({ kind: "ranking_detail", rankShown: true, nameShown: false });
    const screen2 = await connectScreen(id);
    expect((await screen2.next("screen_view")).view).toEqual({ kind: "rank_reveal", rank: 1, nickname: null });
    const stub = env.SESSION_ROOM.getByName(id);
    await runInDurableObject(stub, async (_inst, ctx) => {
      const fresh = new SessionRoom(ctx, env);
      expect(await fresh.ranking()).toMatchObject({ phaseKey: `r:${playerId}:rank`, final: true });
    });
  });
});

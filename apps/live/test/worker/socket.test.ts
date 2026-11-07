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
  /** Drives the host through `from` keys and waits for the last resulting phase. */
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
    const steps: [string, string][] = [["lobby", "q:0:open"]];
    for (let i = 0; i < 5; i++) {
      steps.push([`q:${i}:open`, `q:${i}:closed`], [`q:${i}:closed`, `q:${i}:revealed`]);
      if (i < 4) steps.push([`q:${i}:revealed`, `q:${i + 1}:open`]);
    }
    steps.push(["q:4:revealed", "r:list:0"]);
    await advanceTo(host, steps);
    const pending = await guest.next("guest_view", (m) => m.view.kind === "results_pending");
    expect(pending.view).toMatchObject({ history: expect.any(Array) });
    expect(JSON.stringify(guest.messages)).not.toContain('"rank"');
  });
});

describe("SessionRoom results list paging", () => {
  const settle = () => new Promise((r) => setTimeout(r, 150));

  /** 44 players with distinct scores: 3 on the podium and 41 listed (two list pages). */
  const toResultsList = async () => {
    const id = newSessionId();
    await createSession(id);
    const host = await connectHost(id);
    await host.next("host_view");
    const total = 44;
    // Each guest answers q0 correctly (choice 1) if their index is even; scores only need to exist, ties are fine.
    const guests = await Promise.all(
      Array.from({ length: total }, async (_, i) => {
        const guest = await connectGuest(id);
        await guest.next("need_join");
        guest.send({ type: "join", nickname: `g${i}` });
        await guest.next("joined");
        return guest;
      }),
    );
    await host.next("host_view", (m) => m.view.playerCount === total);
    const keys: [string, string][] = [["lobby", "q:0:open"]];
    for (let i = 0; i < 5; i++) {
      keys.push([`q:${i}:open`, `q:${i}:closed`], [`q:${i}:closed`, `q:${i}:revealed`]);
      if (i < 4) keys.push([`q:${i}:revealed`, `q:${i + 1}:open`]);
    }
    keys.push(["q:4:revealed", "r:list:0"]);
    for (const [from, to] of keys) {
      if (from.endsWith(":open") && from !== "lobby") {
        const index = Number(from.split(":")[1]);
        guests.forEach((g, gi) => g.send({ type: "answer", questionIndex: index, choice: gi < index * 8 + 3 ? 1 : 0 }));
        await settle();
      }
      host.send({ type: "advance", from });
      await host.next("host_view", (m) => m.view.phaseKey === to);
    }
    return { id, host };
  };

  it("pages through the list with advance: page 0 (40 rows) → page 1 → podium", async () => {
    const { id, host } = await toResultsList();
    const screen = await connectScreen(id);
    const first = await screen.next("screen_view");
    const rows = (v: unknown) => (v as { entries: unknown[] }).entries.length;
    expect(first.view).toMatchObject({ kind: "list", page: 0, pageCount: 2 });
    expect(rows(first.view)).toBe(40);

    host.send({ type: "advance", from: "r:list:0" });
    const second = await screen.next("screen_view", (m) => m.view.kind === "list" && m.view.page === 1);
    expect(rows(second.view)).toBe(41 - 40);
    const hv = await host.next("host_view", (m) => m.view.phaseKey === "r:list:1");
    expect(hv.view.screen).toMatchObject({ kind: "list", page: 1, pageCount: 2 });

    host.send({ type: "advance", from: "r:list:1" });
    await screen.next("screen_view", (m) => m.view.kind === "podium");
  }, 30_000);

  it("a repeated advance from the same page key moves only one page", async () => {
    const { id, host } = await toResultsList();
    host.send({ type: "advance", from: "r:list:0" });
    host.send({ type: "advance", from: "r:list:0" });
    await host.next("host_view", (m) => m.view.phaseKey === "r:list:1");
    await settle();
    expect((await rankingOf(id)).body.phaseKey).toBe("r:list:1");
  }, 30_000);

  it("a screen opened on page 1 gets that page, and so does a re-connected host", async () => {
    const { id, host } = await toResultsList();
    host.send({ type: "advance", from: "r:list:0" });
    await host.next("host_view", (m) => m.view.phaseKey === "r:list:1");
    const screen = await connectScreen(id);
    expect((await screen.next("screen_view")).view).toMatchObject({ kind: "list", page: 1, pageCount: 2 });
    const host2 = await connectHost(id);
    expect((await host2.next("host_view")).view.screen).toMatchObject({ kind: "list", page: 1, pageCount: 2 });
  }, 30_000);
});

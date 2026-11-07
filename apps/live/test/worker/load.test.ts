import { describe, expect, it } from "vitest";
import { driveQuiz, type Sock } from "../../src/loadtest/drive";
import sample from "../../fixtures/sample-quiz.json";
import { authHeaders, connectGuest, connectHost, connectScreen, findLast, newSessionId } from "./helpers";
import { exports } from "cloudflare:workers";

const toSock = (c: Awaited<ReturnType<typeof connectHost>>): Sock => {
  return {
    send: (d) => c.ws.send(d),
    onMessage: (cb) => c.ws.addEventListener("message", (e) => cb(e.data as string)),
    close: () => c.ws.close(),
  };
};

describe("load: 150 guests", () => {
  it("every advance reaches all 150 guests within 2000 ms", async () => {
    const id = newSessionId();
    const put = await exports.default.fetch(`https://x/api/sessions/${id}`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify(sample),
    });
    expect(put.status).toBe(201);

    const host = await connectHost(id);
    const screen = await connectScreen(id);
    // Register message handlers (inside driveQuiz) before any guest message can
    // arrive: connect() has already accepted the sockets, so buffer via replay.
    const guestClients = await Promise.all(Array.from({ length: 150 }, () => connectGuest(id)));

    const replay = (c: typeof host): Sock => {
      const sock = toSock(c);
      return {
        ...sock,
        onMessage(cb) {
          for (const m of c.messages) cb(JSON.stringify(m));
          sock.onMessage(cb);
        },
      };
    };

    const result = await driveQuiz({
      host: replay(host),
      guests: guestClients.map(replay),
      log: (l) => console.log(l),
    });
    // The projector gets one screen_view per advance. Wait for them instead of sleeping a fixed time.
    const screenStages = () => screen.messages.flatMap((m) => (m.type === "screen_view" && m.view.kind !== "lobby" ? [m.view] : []));
    const deadline = Date.now() + 5000;
    while (screenStages().length < result.advances.length && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(screenStages()).toHaveLength(result.advances.length);
    console.log(`worst advance ${result.worstMs.toFixed(0)} ms, missing ${result.totalMissing}`);

    expect(result.advances.length).toBe(sample.questions.length * 3 + 1);
    expect(result.totalMissing).toBe(0);
    expect(result.worstMs).toBeLessThanOrEqual(2000);
    expect(result.pass).toBe(true);

    const rankingView = findLast(
      host.messages,
      (m) => m.type === "host_view" && m.view.screen.kind === "ranking",
    );
    if (!rankingView || rankingView.type !== "host_view" || rankingView.view.screen.kind !== "ranking") {
      throw new Error("expected ranking host_view after driveQuiz");
    }
    const playerId = rankingView.view.screen.entries[0].playerId;
    const guestCounts = guestClients.map((c) => c.messages.length);
    host.send({ type: "results_action", from: "r:list", action: { kind: "select", playerId } });
    await host.next("host_view", (m) => m.view.screen.kind === "ranking_detail");
    host.send({ type: "results_action", from: `r:${playerId}:hidden`, action: { kind: "show_rank" } });
    await host.next("host_view", (m) => m.view.phaseKey === `r:${playerId}:rank`);
    await new Promise((r) => setTimeout(r, 300));
    guestClients.forEach((c, i) => expect(c.messages.length).toBe(guestCounts[i]));

    screen.ws.close();
    guestClients.forEach((c) => c.ws.close());
    host.ws.close();
  }, 60_000);
});

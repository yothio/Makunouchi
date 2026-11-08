import { describe, expect, it } from "vitest";
import { driveQuiz, type Sock } from "../../src/loadtest/drive";
import sample from "../../fixtures/sample-quiz.json";
import { authHeaders, connectGuest, connectHost, connectScreen, newSessionId } from "./helpers";
import { exports } from "cloudflare:workers";

const toSock = (c: Awaited<ReturnType<typeof connectHost>>): Sock => {
  return {
    send: (d) => c.ws.send(d),
    onMessage: (cb) => c.ws.addEventListener("message", (e) => cb(e.data as string)),
    close: () => c.ws.close(),
  };
};

describe("load: 150 guests", () => {
  it("quiz advances and podium actions reach host/screen within 2000 ms; guests stay results_pending", async () => {
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
      screen: replay(screen),
      guests: guestClients.map(replay),
      log: (l) => console.log(l),
    });
    console.log(`worst ${result.worstMs.toFixed(0)} ms, missing ${result.totalMissing}`);

    expect(result.advances.length).toBe(sample.questions.length * 3 + 1);
    expect(result.advances.every((a) => a.screenMissing === 0 && a.screenMs <= 2000)).toBe(true);
    expect(result.podium.length).toBe(12);
    expect(result.totalMissing).toBe(0);
    expect(result.worstMs).toBeLessThanOrEqual(2000);
    expect(result.pass).toBe(true);
    expect(result.podium.every((p) => p.guestExtra === 0)).toBe(true);
    expect(result.podium.every((p) => p.hostMs <= 2000 && p.screenMs <= 2000)).toBe(true);

    const lastGuestViews = guestClients.map((c) => {
      const views = c.messages.filter((m) => m.type === "guest_view");
      return views[views.length - 1];
    });
    expect(lastGuestViews.every((m) => m?.type === "guest_view" && m.view.kind === "results_pending")).toBe(true);

    screen.ws.close();
    guestClients.forEach((c) => c.ws.close());
    host.ws.close();
  }, 90_000);
});

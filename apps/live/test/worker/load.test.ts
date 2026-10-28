import { describe, expect, it } from "vitest";
import { driveQuiz, type Sock } from "../../src/loadtest/drive";
import sample from "../../fixtures/sample-quiz.json";
import { authHeaders, connectGuest, connectHost, newSessionId } from "./helpers";
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
    console.log(`worst advance ${result.worstMs.toFixed(0)} ms, missing ${result.totalMissing}`);
    guestClients.forEach((c) => c.ws.close());
    host.ws.close();

    expect(result.advances.length).toBe(sample.questions.length * 3 + 1);
    expect(result.totalMissing).toBe(0);
    expect(result.worstMs).toBeLessThanOrEqual(2000);
    expect(result.pass).toBe(true);
  }, 60_000);
});

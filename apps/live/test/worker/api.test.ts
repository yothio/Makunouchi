import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hostTokenFor, screenTokenFor } from "../../src/worker/auth";
import { authHeaders, connectHost, createSession, driveToResults, newSessionId, quiz } from "./helpers";

const put = (id: string, body: unknown, headers: Record<string, string> = authHeaders) =>
  exports.default.fetch(`https://x/api/sessions/${id}`, { method: "PUT", headers, body: JSON.stringify(body) });

describe("sessions API", () => {
  it("PUT without Bearer is 401", async () => {
    const res = await put(newSessionId(), quiz, { "Content-Type": "application/json" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("PUT with wrong Bearer is 401", async () => {
    const res = await put(newSessionId(), quiz, { Authorization: "Bearer nope" });
    expect(res.status).toBe(401);
  });

  it("PUT creates 201, second PUT is 409", async () => {
    const id = newSessionId();
    expect((await createSession(id)).status).toBe(201);
    expect((await createSession(id)).status).toBe(409);
  });

  it("PUT with a session id containing ':' is 400 invalid_session_id and creates nothing", async () => {
    const res = await put("screen:abc", quiz);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_session_id" });
    const ranking = await exports.default.fetch("https://x/api/sessions/screen:abc/ranking", { headers: authHeaders });
    expect(ranking.status).toBe(404);
  });

  it("PUT with a UUID session id is 201", async () => {
    expect((await put(crypto.randomUUID(), quiz)).status).toBe(201);
  });

  it("invalid payload is 422 with issues", async () => {
    const res = await put(newSessionId(), { title: "x" });
    expect(res.status).toBe(422);
    const body = (await res.json()) as any;
    expect(body.error).toBe("invalid_payload");
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it("non-JSON body is 422", async () => {
    const res = await exports.default.fetch(`https://x/api/sessions/${newSessionId()}`, {
      method: "PUT",
      headers: authHeaders,
      body: "not json",
    });
    expect(res.status).toBe(422);
  });

  it("ranking of an uncreated session is 404", async () => {
    const res = await exports.default.fetch(`https://x/api/sessions/${newSessionId()}/ranking`, { headers: authHeaders });
    expect(res.status).toBe(404);
  });

  it("ranking requires auth", async () => {
    const res = await exports.default.fetch(`https://x/api/sessions/${newSessionId()}/ranking`);
    expect(res.status).toBe(401);
  });

  it("ranking of a fresh session", async () => {
    const id = newSessionId();
    await createSession(id);
    const res = await exports.default.fetch(`https://x/api/sessions/${id}/ranking`, { headers: authHeaders });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ phaseKey: "lobby", final: false, players: [] });
  });

  it("ranking の final は results に入ってから true。players は順位つき全員", async () => {
    const id = newSessionId();
    await createSession(id);
    const host = await connectHost(id);
    await host.next("host_view");
    const mid = await exports.default.fetch(`https://x/api/sessions/${id}/ranking`, { headers: authHeaders });
    expect(await mid.json()).toMatchObject({ phaseKey: "lobby", final: false });
    host.send({ type: "advance", from: "lobby" });
    await host.next("host_view", (m) => m.view.phaseKey === "q:0:open");
    const question = await exports.default.fetch(`https://x/api/sessions/${id}/ranking`, { headers: authHeaders });
    expect(await question.json()).toMatchObject({ phaseKey: "q:0:open", final: false });
    await driveToResults(host, id, "q:0:open");
    const done =await exports.default.fetch(`https://x/api/sessions/${id}/ranking`, { headers: authHeaders });
    expect(await done.json()).toMatchObject({ phaseKey: "r:list", final: true, players: [] });
  });

  it("host WebSocket with wrong token is 401", async () => {
    const id = newSessionId();
    await createSession(id);
    const res = await exports.default.fetch(`https://x/ws/${id}/host?token=bad`, { headers: { Upgrade: "websocket" } });
    expect(res.status).toBe(401);
  });

  it("host WebSocket without token is 401", async () => {
    const id = newSessionId();
    await createSession(id);
    const res = await exports.default.fetch(`https://x/ws/${id}/host`, { headers: { Upgrade: "websocket" } });
    expect(res.status).toBe(401);
  });

  it("screen WebSocket without a token or with a wrong token is 401", async () => {
    const id = newSessionId();
    await createSession(id);
    const none = await exports.default.fetch(`https://x/ws/${id}/screen`, { headers: { Upgrade: "websocket" } });
    expect(none.status).toBe(401);
    const bad = await exports.default.fetch(`https://x/ws/${id}/screen?token=bad`, { headers: { Upgrade: "websocket" } });
    expect(bad.status).toBe(401);
  });

  it("the host token cannot open the screen, and the screen token cannot open the host", async () => {
    const id = newSessionId();
    await createSession(id);
    const hostToken = await hostTokenFor(env.ADMIN_API_SECRET, id);
    const screenToken = await screenTokenFor(env.ADMIN_API_SECRET, id);
    const screenWithHostToken = await exports.default.fetch(`https://x/ws/${id}/screen?token=${hostToken}`, {
      headers: { Upgrade: "websocket" },
    });
    expect(screenWithHostToken.status).toBe(401);
    const hostWithScreenToken = await exports.default.fetch(`https://x/ws/${id}/host?token=${screenToken}`, {
      headers: { Upgrade: "websocket" },
    });
    expect(hostWithScreenToken.status).toBe(401);
  });

  it("WebSocket to an invalid session id is 404 for every role", async () => {
    for (const role of ["host", "screen", "guest"]) {
      const res = await exports.default.fetch(`https://x/ws/screen:abc/${role}?token=x`, { headers: { Upgrade: "websocket" } });
      expect(res.status).toBe(404);
    }
  });

  it("WebSocket to uncreated session is 404", async () => {
    const id = newSessionId();
    const token = await hostTokenFor(env.ADMIN_API_SECRET, id);
    const host = await exports.default.fetch(`https://x/ws/${id}/host?token=${token}`, { headers: { Upgrade: "websocket" } });
    expect(host.status).toBe(404);
    const guest = await exports.default.fetch(`https://x/ws/${id}/guest`, { headers: { Upgrade: "websocket" } });
    expect(guest.status).toBe(404);
    const screenToken = await screenTokenFor(env.ADMIN_API_SECRET, id);
    const screen = await exports.default.fetch(`https://x/ws/${id}/screen?token=${screenToken}`, { headers: { Upgrade: "websocket" } });
    expect(screen.status).toBe(404);
  });

  it("hostTokenFor is deterministic hex of 64 chars", async () => {
    const secret = "s".repeat(32);
    const a = await hostTokenFor(secret, "id");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hostTokenFor(secret, "id")).toBe(a);
    expect(await hostTokenFor(secret, "id2")).not.toBe(a);
  });
});

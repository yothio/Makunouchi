import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hostTokenFor } from "../../src/worker/auth";
import { authHeaders, createSession, newSessionId, quiz } from "./helpers";

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

  it("WebSocket to uncreated session is 404", async () => {
    const id = newSessionId();
    const token = await hostTokenFor(env.ADMIN_API_SECRET, id);
    const host = await exports.default.fetch(`https://x/ws/${id}/host?token=${token}`, { headers: { Upgrade: "websocket" } });
    expect(host.status).toBe(404);
    const guest = await exports.default.fetch(`https://x/ws/${id}/guest`, { headers: { Upgrade: "websocket" } });
    expect(guest.status).toBe(404);
  });

  it("hostTokenFor is deterministic hex of 64 chars", async () => {
    const a = await hostTokenFor("s", "id");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hostTokenFor("s", "id")).toBe(a);
    expect(await hostTokenFor("s", "id2")).not.toBe(a);
  });
});

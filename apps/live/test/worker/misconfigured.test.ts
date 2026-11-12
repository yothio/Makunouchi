import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { WS_CLOSE_SESSION_NOT_FOUND } from "@shared/ws-close";
import app from "@worker/index";
import { newSessionId, quiz } from "./helpers";

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const call = (secret: string | undefined, path: string, init?: RequestInit) => {
  return app.fetch(new Request(`https://x${path}`, init), { ...env, ADMIN_API_SECRET: secret } as Env, ctx);
};

const closeCodeOf = async (res: Response): Promise<number> => {
  if (res.status !== 101 || !res.webSocket) {
    throw new Error(`expected 101 with webSocket, got ${res.status}`);
  }
  const ws = res.webSocket;
  const closed = new Promise<number>((resolve) => {
    ws.addEventListener("close", (e) => resolve(e.code));
  });
  ws.accept();
  return Promise.race([
    closed,
    new Promise<number>((_, reject) => {
      setTimeout(() => reject(new Error("timed out waiting for close")), 3000);
    }),
  ]);
};

describe.each([
  ["missing", undefined],
  ["empty", ""],
  ["short", "0123456789"],
])("ADMIN_API_SECRET %s", (_label, secret) => {
  const id = newSessionId();
  const misconfigured = async (res: Response) => {
    return { status: res.status, body: await res.json() };
  };
  const expected = { status: 500, body: { error: "misconfigured" } };

  it.each(["Bearer ", `Bearer ${secret ?? ""}`, "Bearer anything"])("PUT create with %j", async (authorization) => {
    expect(await misconfigured(
      await call(secret, `/api/sessions/${id}`, {
        method: "PUT",
        headers: { Authorization: authorization, "Content-Type": "application/json" },
        body: JSON.stringify(quiz),
      })),
    ).toEqual(expected);
  });

  it("GET ranking", async () => {
    expect(await misconfigured(
      await call(secret, `/api/sessions/${id}/ranking`, { headers: { Authorization: "Bearer " } })),
    ).toEqual(expected);
  });

  it("host WebSocket upgrade", async () => {
    expect(await misconfigured(
      await call(secret, `/ws/${id}/host?token=abc`, { headers: { Upgrade: "websocket" } })),
    ).toEqual(expected);
  });

  it("guest WebSocket and health do not need the secret", async () => {
    const guest = await call(secret, `/ws/${id}/guest`, { headers: { Upgrade: "websocket" } });
    // Uncreated session: accept then close 4404 (permanent). Must not report misconfigured.
    expect(guest.status).toBe(101);
    expect(await closeCodeOf(guest)).toBe(WS_CLOSE_SESSION_NOT_FOUND);
    expect((await call(secret, "/api/health")).status).toBe(200);
  });
});

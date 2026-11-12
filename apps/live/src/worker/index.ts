import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { WS_CLOSE_SESSION_NOT_FOUND, WS_CLOSE_UNAUTHORIZED } from "@shared/ws-close";
import { hostTokenFor, isUsableSecret, isValidSessionId, safeEqual, screenTokenFor, verifyBearer } from "./auth";
import { quizPayloadSchema } from "./payload";
import { isRole, ROLE_HEADER, type Role } from "./role";
import { rejectWebSocket } from "./ws-reject";

export { SessionRoom } from "./session-room";

/** Weddings are in Japan; pin the DO near there even if Rails (Cloud Run) happens to call first from elsewhere. */
const roomFor = (env: Env, sessionId: string) => {
  return env.SESSION_ROOM.getByName(sessionId, { locationHint: "apac-ne" });
};

const tokenFor = (role: Exclude<Role, "guest">, secret: string, sessionId: string): Promise<string> => {
  return role === "host" ? hostTokenFor(secret, sessionId) : screenTokenFor(secret, sessionId);
};

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));

// ADMIN_API_SECRET 未設定時は 500（認証を一切通さない）
const requireAdminSecret = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  if (!isUsableSecret(c.env.ADMIN_API_SECRET)) {
    console.error("ADMIN_API_SECRET is missing or shorter than the minimum length; refusing request");
    return c.json({ error: "misconfigured" }, 500);
  }
  await next();
});

// Outside `/api/sessions/*` so the browser can call it without Bearer (browsers never hold ADMIN_API_SECRET).
app.post("/api/host-login/:sessionId", requireAdminSecret, async (c) => {
  const sessionId = c.req.param("sessionId");
  if (!isValidSessionId(sessionId)) return c.json({ error: "invalid_session_id" }, 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }
  if (!body || typeof body !== "object") return c.json({ error: "invalid_body" }, 400);
  const loginId = (body as { loginId?: unknown }).loginId;
  const password = (body as { password?: unknown }).password;
  if (typeof loginId !== "string" || typeof password !== "string") {
    return c.json({ error: "invalid_body" }, 400);
  }
  const result = await roomFor(c.env, sessionId).hostLogin(loginId, password);
  if (result === "missing") return c.json({ error: "not_found" }, 404);
  if (result === "locked") return c.json({ error: "too_many_attempts" }, 429);
  if (result === "invalid") return c.json({ error: "invalid_credentials" }, 401);
  return c.json({ token: await hostTokenFor(c.env.ADMIN_API_SECRET, sessionId) });
});

app.use("/api/sessions/*", requireAdminSecret, async (c, next) => {
  if (!verifyBearer(c.req.raw, c.env.ADMIN_API_SECRET)) return c.json({ error: "unauthorized" }, 401);
  await next();
});

app.put("/api/sessions/:sessionId", async (c) => {
  if (!isValidSessionId(c.req.param("sessionId"))) return c.json({ error: "invalid_session_id" }, 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_payload", issues: [{ message: "body must be JSON" }] }, 422);
  }
  const parsed = quizPayloadSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_payload", issues: parsed.error.issues }, 422);
  // Keep host credentials out of GameState ("state" kv key).
  const { host, ...quiz } = parsed.data;
  const result = await roomFor(c.env, c.req.param("sessionId")).init(quiz, host);
  if (result !== "created") return c.json({ error: "exists" }, 409);
  return host ? c.json({ ok: true, host: true }, 201) : c.json({ ok: true }, 201);
});

app.get("/api/sessions/:sessionId/ranking", async (c) => {
  const sessionId = c.req.param("sessionId");
  if (!isValidSessionId(sessionId)) return c.json({ error: "not_found" }, 404);
  const ranking = await roomFor(c.env, sessionId).ranking();
  if (!ranking) return c.json({ error: "not_found" }, 404);
  return c.json(ranking);
});

app.get(
  "/ws/:sessionId/:role",
  async (c, next) => {
    const role = c.req.param("role");
    if (role === "host" || role === "screen") return requireAdminSecret(c, next);
    await next();
  },
  async (c) => {
    const { sessionId, role } = c.req.param();
    const wantsSocket = c.req.header("Upgrade") === "websocket";
    if (!isRole(role) || !isValidSessionId(sessionId)) {
      if (wantsSocket) return rejectWebSocket(WS_CLOSE_SESSION_NOT_FOUND, "not found");
      return c.json({ error: "not_found" }, 404);
    }
    if (!wantsSocket) return c.json({ error: "expected_websocket" }, 426);
    if (role !== "guest") {
      const expected = await tokenFor(role, c.env.ADMIN_API_SECRET, sessionId);
      if (!safeEqual(c.req.query("token") ?? "", expected)) {
        // Token check stays in the Worker so a bad token never wakes the DO.
        return rejectWebSocket(WS_CLOSE_UNAUTHORIZED, "unauthorized");
      }
    }
    // The role is decided here; the DO only reads this header (overwriting any client-supplied value).
    const forwarded = new Request(c.req.raw);
    forwarded.headers.set(ROLE_HEADER, role);
    return roomFor(c.env, sessionId).fetch(forwarded);
  },
);

export default app;

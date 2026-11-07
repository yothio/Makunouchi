import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { hostTokenFor, isUsableSecret, isValidSessionId, safeEqual, screenTokenFor, verifyBearer } from "./auth";
import { quizPayloadSchema } from "./payload";
import { isRole, ROLE_HEADER, type Role } from "./role";

export { SessionRoom } from "./session-room";

/** Weddings are in Japan; pin the DO near there even if Rails (Cloud Run) happens to call first from elsewhere. */
const roomFor = (env: Env, sessionId: string) => {
  return env.SESSION_ROOM.getByName(sessionId, { locationHint: "apac-ne" });
};

/** The token a host or screen connection must present for this session. */
const tokenFor = (role: Exclude<Role, "guest">, secret: string, sessionId: string): Promise<string> => {
  return role === "host" ? hostTokenFor(secret, sessionId) : screenTokenFor(secret, sessionId);
};

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));

/** Fail closed: refuse to authenticate anything while ADMIN_API_SECRET is missing or too short. */
const requireAdminSecret = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  if (!isUsableSecret(c.env.ADMIN_API_SECRET)) {
    console.error("ADMIN_API_SECRET is missing or shorter than the minimum length; refusing request");
    return c.json({ error: "misconfigured" }, 500);
  }
  await next();
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
  const result = await roomFor(c.env, c.req.param("sessionId")).init(parsed.data);
  return result === "created" ? c.json({ ok: true }, 201) : c.json({ error: "exists" }, 409);
});

app.get("/api/sessions/:sessionId/ranking", async (c) => {
  const ranking = await roomFor(c.env, c.req.param("sessionId")).ranking();
  if (!ranking) return c.json({ error: "not_found" }, 404);
  return c.json(ranking);
});

app.get(
  "/ws/:sessionId/:role",
  async (c, next) => {
    // host and screen are authenticated with tokens derived from ADMIN_API_SECRET.
    const role = c.req.param("role");
    if (role === "host" || role === "screen") return requireAdminSecret(c, next);
    await next();
  },
  async (c) => {
    const { sessionId, role } = c.req.param();
    if (!isRole(role)) return c.json({ error: "not_found" }, 404);
    if (c.req.header("Upgrade") !== "websocket") return c.json({ error: "expected_websocket" }, 426);
    if (role !== "guest") {
      const expected = await tokenFor(role, c.env.ADMIN_API_SECRET, sessionId);
      if (!safeEqual(c.req.query("token") ?? "", expected)) return c.json({ error: "unauthorized" }, 401);
    }
    // SessionRoom.fetch returns 404 itself when the session was never initialised.
    // The role is decided here; the DO only reads this header (overwriting any client-supplied value).
    const forwarded = new Request(c.req.raw);
    forwarded.headers.set(ROLE_HEADER, role);
    return roomFor(c.env, sessionId).fetch(forwarded);
  },
);

export default app;

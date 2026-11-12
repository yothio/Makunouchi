import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hostTokenFor } from "@worker/auth";
import { authHeaders, connectHost, connectGuest, connectScreen, newSessionId, quiz } from "./helpers";

/** Rails HostCredentials と同じ PBKDF2 固定ベクタ（auth.test と共有）。 */
const FIXED_PASSWORD = "correct horse";
const FIXED_HASH =
  "pbkdf2-sha256$100000$AAECAwQFBgcICQoLDA0ODw==$V/LC8HOXSNUWQZsGKohGZjI8WD6krhZVBKgfe1PGKgk=";
const FIXED_LOGIN_ID = "hostdemo";

const quizWithHost = {
  ...quiz,
  host: { loginId: FIXED_LOGIN_ID, passwordHash: FIXED_HASH },
};

const put = (id: string, body: unknown) =>
  exports.default.fetch(`https://x/api/sessions/${id}`, {
    method: "PUT",
    headers: authHeaders,
    body: JSON.stringify(body),
  });

const login = (id: string, body: unknown, init: RequestInit = {}) =>
  exports.default.fetch(`https://x/api/host-login/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(init.headers as Record<string, string> | undefined) },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });

describe("host in PUT payload", () => {
  it("host なしの PUT は 201 で host:true を付けない", async () => {
    const id = newSessionId();
    const res = await put(id, quiz);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("host つき PUT は 201 で host:true を付ける", async () => {
    const id = newSessionId();
    const res = await put(id, quizWithHost);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, host: true });
  });

  it("壊れた passwordHash は 422", async () => {
    const id = newSessionId();
    const res = await put(id, {
      ...quiz,
      host: { loginId: FIXED_LOGIN_ID, passwordHash: "not-a-hash" },
    });
    expect(res.status).toBe(422);
  });

  it("不正な loginId は 422", async () => {
    const id = newSessionId();
    const res = await put(id, {
      ...quiz,
      host: { loginId: "ab", passwordHash: FIXED_HASH },
    });
    expect(res.status).toBe(422);
  });

  it("host 保存後にログインでき、各ビューと ranking に資格情報が現れない", async () => {
    const id = newSessionId();
    await put(id, quizWithHost);
    expect((await login(id, { loginId: FIXED_LOGIN_ID, password: FIXED_PASSWORD })).status).toBe(200);

    const host = await connectHost(id);
    const hostView = await host.next("host_view");
    expect(JSON.stringify(hostView)).not.toContain("passwordHash");
    expect(JSON.stringify(hostView)).not.toContain(FIXED_LOGIN_ID);
    expect(JSON.stringify(hostView)).not.toContain(FIXED_HASH);

    const screen = await connectScreen(id);
    const screenView = await screen.next("screen_view");
    expect(JSON.stringify(screenView)).not.toContain("passwordHash");
    expect(JSON.stringify(screenView)).not.toContain(FIXED_LOGIN_ID);
    expect(JSON.stringify(screenView)).not.toContain(FIXED_HASH);

    const guest = await connectGuest(id);
    guest.send({ type: "join", nickname: "alice" });
    const joined = await guest.next("joined");
    expect(joined.playerToken).toBeTruthy();
    const guestView = await guest.next("guest_view");
    expect(JSON.stringify(guestView)).not.toContain("passwordHash");
    expect(JSON.stringify(guestView)).not.toContain(FIXED_LOGIN_ID);

    const ranking = await exports.default.fetch(`https://x/api/sessions/${id}/ranking`, { headers: authHeaders });
    expect(JSON.stringify(await ranking.json())).not.toContain("passwordHash");
  });
});

describe("POST /api/host-login/:sessionId", () => {
  it("正しい ID/パスワードで 200 と幹事 HMAC トークンを返す（Bearer 不要）", async () => {
    const id = newSessionId();
    await put(id, quizWithHost);
    const res = await login(id, { loginId: FIXED_LOGIN_ID, password: FIXED_PASSWORD });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    expect(body.token).toBe(await hostTokenFor(env.ADMIN_API_SECRET, id));
  });

  it("固定ベクタのパスワードで照合が通る", async () => {
    const id = newSessionId();
    await put(id, quizWithHost);
    const res = await login(id, { loginId: FIXED_LOGIN_ID, password: FIXED_PASSWORD });
    expect(res.status).toBe(200);
  });

  it("ID 違いとパスワード違いは同じ 401 invalid_credentials", async () => {
    const id = newSessionId();
    await put(id, quizWithHost);
    const wrongId = await login(id, { loginId: "wrongid1", password: FIXED_PASSWORD });
    const wrongPw = await login(id, { loginId: FIXED_LOGIN_ID, password: "wrong password" });
    expect(wrongId.status).toBe(401);
    expect(wrongPw.status).toBe(401);
    expect(await wrongId.json()).toEqual({ error: "invalid_credentials" });
    expect(await wrongPw.json()).toEqual({ error: "invalid_credentials" });
  });

  it("host 未登録の開催回は 404", async () => {
    const id = newSessionId();
    await put(id, quiz);
    const res = await login(id, { loginId: FIXED_LOGIN_ID, password: FIXED_PASSWORD });
    expect(res.status).toBe(404);
  });

  it("開催回が無いときも 404", async () => {
    const res = await login(newSessionId(), { loginId: FIXED_LOGIN_ID, password: FIXED_PASSWORD });
    expect(res.status).toBe(404);
  });

  it("不正な開催回 ID は 400 invalid_session_id", async () => {
    const res = await login("screen:abc", { loginId: FIXED_LOGIN_ID, password: FIXED_PASSWORD });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_session_id" });
  });

  it("JSON でない本文は 400", async () => {
    const id = newSessionId();
    await put(id, quizWithHost);
    const res = await exports.default.fetch(`https://x/api/host-login/${id}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
  });

  it("11 回目の失敗は 429（照合は 10 回まで）", async () => {
    const id = newSessionId();
    await put(id, quizWithHost);
    for (let i = 0; i < 10; i++) {
      const res = await login(id, { loginId: FIXED_LOGIN_ID, password: "bad" });
      expect(res.status).toBe(401);
    }
    const locked = await login(id, { loginId: FIXED_LOGIN_ID, password: "bad" });
    expect(locked.status).toBe(429);
    expect(await locked.json()).toEqual({ error: "too_many_attempts" });
  });

  it("10 回目が正しい資格情報なら成功する", async () => {
    const id = newSessionId();
    await put(id, quizWithHost);
    for (let i = 0; i < 9; i++) {
      expect((await login(id, { loginId: FIXED_LOGIN_ID, password: "bad" })).status).toBe(401);
    }
    const ok = await login(id, { loginId: FIXED_LOGIN_ID, password: FIXED_PASSWORD });
    expect(ok.status).toBe(200);
  });

  it("成功すると失敗回数が消え、再び失敗してもすぐにはロックされない", async () => {
    const id = newSessionId();
    await put(id, quizWithHost);
    for (let i = 0; i < 9; i++) {
      await login(id, { loginId: FIXED_LOGIN_ID, password: "bad" });
    }
    expect((await login(id, { loginId: FIXED_LOGIN_ID, password: FIXED_PASSWORD })).status).toBe(200);
    expect((await login(id, { loginId: FIXED_LOGIN_ID, password: "bad" })).status).toBe(401);
    expect((await login(id, { loginId: FIXED_LOGIN_ID, password: "bad" })).status).toBe(401);
  });

  it("同時 20 リクエストでも照合が走るのは 10 回まで", async () => {
    const id = newSessionId();
    await put(id, quizWithHost);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => login(id, { loginId: FIXED_LOGIN_ID, password: "bad" })),
    );
    const statuses = results.map((r) => r.status);
    const unauthorized = statuses.filter((s) => s === 401).length;
    const tooMany = statuses.filter((s) => s === 429).length;
    expect(unauthorized).toBe(10);
    expect(tooMany).toBe(10);
  });
});

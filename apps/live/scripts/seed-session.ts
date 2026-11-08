// Usage: ADMIN_API_SECRET=... pnpm --filter live seed <baseUrl> [quiz.json]
import { readFileSync } from "node:fs";
import { hostTokenFor, screenTokenFor } from "../src/worker/auth.ts";
import { normalizeBase, requireSecret } from "./env.ts";

/** Password that matches the fixed-vector hash in fixtures/sample-quiz.json (Task 4 / Task 6). */
const SAMPLE_HOST_PASSWORD = "correct horse";

const secret = requireSecret();
const base = normalizeBase(process.argv[2]);
const file = process.argv[3] ?? new URL("../fixtures/sample-quiz.json", import.meta.url).pathname;
const quiz = JSON.parse(readFileSync(file, "utf8")) as {
  host?: { loginId?: string; passwordHash?: string };
};
const sessionId = crypto.randomUUID();

const res = await fetch(new URL(`/api/sessions/${sessionId}`, base), {
  method: "PUT",
  headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
  body: JSON.stringify(quiz),
});
if (res.status !== 201) {
  console.error(`PUT failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const created = (await res.json()) as { ok?: boolean; host?: boolean };
const hostToken = await hostTokenFor(secret, sessionId);
const screenToken = await screenTokenFor(secret, sessionId);
console.log(`sessionId  : ${sessionId}`);
console.log(`ゲスト URL  : ${new URL(`/s/${sessionId}`, base)}`);
console.log(`幹事画面 URL: ${new URL(`/host/${sessionId}`, base)}`);
console.log(`幹事トークン URL（緊急時）: ${new URL(`/host/${sessionId}?token=${hostToken}`, base)}`);
console.log(`投影画面 URL: ${new URL(`/screen/${sessionId}?token=${screenToken}`, base)}`);
if (created.host && quiz.host?.loginId) {
  console.log(`幹事 ID    : ${quiz.host.loginId}`);
  if (quiz.host.passwordHash?.includes("AAECAwQFBgcICQoLDA0ODw==")) {
    console.log(`幹事 PASS  : ${SAMPLE_HOST_PASSWORD}`);
  } else {
    console.log(`幹事 PASS  : （フィクスチャの passwordHash に対応する平文を用意してください）`);
  }
}

// Usage: ADMIN_API_SECRET=... pnpm --filter live seed <baseUrl> [quiz.json]
import { readFileSync } from "node:fs";
import { hostTokenFor } from "../src/worker/auth.ts";
import { normalizeBase, requireSecret } from "./env.ts";

const secret = requireSecret();
const base = normalizeBase(process.argv[2]);
const file = process.argv[3] ?? new URL("../fixtures/sample-quiz.json", import.meta.url).pathname;
const quiz = JSON.parse(readFileSync(file, "utf8"));
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
const token = await hostTokenFor(secret, sessionId);
console.log(`sessionId : ${sessionId}`);
console.log(`ゲスト URL : ${new URL(`/s/${sessionId}`, base)}`);
console.log(`投影画面 URL: ${new URL(`/host/${sessionId}?token=${token}`, base)}`);

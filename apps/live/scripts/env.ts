export function requireSecret(): string {
  const secret = process.env.ADMIN_API_SECRET;
  if (!secret) {
    console.error("ADMIN_API_SECRET が未設定です。例: ADMIN_API_SECRET=xxxx pnpm --filter live seed <baseUrl>");
    process.exit(1);
  }
  return secret;
}

export function normalizeBase(raw: string | undefined): URL {
  if (!raw) {
    console.error("baseUrl を指定してください (例: http://localhost:5173 / https://makunouchi-live.<account>.workers.dev)");
    process.exit(1);
  }
  return new URL(raw);
}

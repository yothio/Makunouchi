const MIN_ADMIN_SECRET_LENGTH = 32;

export const requireSecret = (): string => {
  const secret = process.env.ADMIN_API_SECRET;
  if (!secret) {
    console.error("ADMIN_API_SECRET が未設定です。例: ADMIN_API_SECRET=xxxx pnpm --filter live seed <baseUrl>");
    process.exit(1);
  }
  if (secret.length < MIN_ADMIN_SECRET_LENGTH) {
    console.error(`ADMIN_API_SECRET が短すぎます（${MIN_ADMIN_SECRET_LENGTH} 文字以上が必要です）。`);
    process.exit(1);
  }
  return secret;
};

export const normalizeBase = (raw: string | undefined): URL => {
  if (!raw) {
    console.error("baseUrl を指定してください (例: http://localhost:5173 / https://makunouchi-live.<account>.workers.dev)");
    process.exit(1);
  }
  return new URL(raw);
};

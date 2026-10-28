const encoder = new TextEncoder();

const hmacHex = async (secret: string, message: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

export const MIN_ADMIN_SECRET_LENGTH = 32;

/** A secret is usable only when it is a string of at least MIN_ADMIN_SECRET_LENGTH characters. */
export const isUsableSecret = (secret: unknown): secret is string => {
  return typeof secret === "string" && secret.length >= MIN_ADMIN_SECRET_LENGTH;
};

export const hostTokenFor = (secret: string, sessionId: string): Promise<string> => {
  if (!isUsableSecret(secret)) {
    throw new Error(`ADMIN_API_SECRET must be at least ${MIN_ADMIN_SECRET_LENGTH} characters`);
  }
  return hmacHex(secret, sessionId);
};

/** Constant-time string comparison (length difference is not hidden). */
export const safeEqual = (a: string, b: string): boolean => {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
};

export const verifyBearer = (req: Request, secret: string): boolean => {
  if (!isUsableSecret(secret)) return false;
  const header = req.headers.get("Authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  return safeEqual(header.slice(prefix.length), secret);
};

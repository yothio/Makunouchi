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

export const isUsableSecret = (secret: unknown): secret is string => {
  return typeof secret === "string" && secret.length >= MIN_ADMIN_SECRET_LENGTH;
};

export const hostTokenFor = (secret: string, sessionId: string): Promise<string> => {
  if (!isUsableSecret(secret)) {
    throw new Error(`ADMIN_API_SECRET must be at least ${MIN_ADMIN_SECRET_LENGTH} characters`);
  }
  return hmacHex(secret, sessionId);
};

/**
 * Read-only credential for the projector screen. The input is `"screen:" + sessionId`, so it can never equal
 * a host token input as long as session ids contain no ":" (see `isValidSessionId`, enforced at session creation).
 */
export const screenTokenFor = (secret: string, sessionId: string): Promise<string> => {
  if (!isUsableSecret(secret)) {
    throw new Error(`ADMIN_API_SECRET must be at least ${MIN_ADMIN_SECRET_LENGTH} characters`);
  }
  return hmacHex(secret, `screen:${sessionId}`);
};

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

/** Session ids are issued by Rails (UUIDs). ":" is excluded so host / screen token inputs cannot collide. */
export const isValidSessionId = (id: string): boolean => {
  return SESSION_ID_PATTERN.test(id);
};

/** Constant-time comparison for equal-length byte strings (tokens, secrets, hash b64). Length mismatch returns false immediately. */
export const safeEqual = (a: string, b: string): boolean => {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
};

const digestEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
};

/**
 * Constant-time equality for variable-length strings (e.g. loginId): compare SHA-256 digests
 * so a length mismatch does not return early.
 */
export const safeEqualDigest = async (a: string, b: string): Promise<boolean> => {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  return digestEqual(new Uint8Array(ha), new Uint8Array(hb));
};

export const verifyBearer = (req: Request, secret: string): boolean => {
  if (!isUsableSecret(secret)) return false;
  const header = req.headers.get("Authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  return safeEqual(header.slice(prefix.length), secret);
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};

const parsePbkdf2 = (
  encoded: string,
): { iterations: number; salt: Uint8Array; hashB64: string } | null => {
  const parts = encoded.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return null;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100_000) return null;
  try {
    const saltBin = atob(parts[2]);
    const hashBin = atob(parts[3]);
    if (saltBin.length !== 16 || hashBin.length !== 32) return null;
    // Copy into a fresh ArrayBuffer-backed view for WebCrypto's BufferSource typing.
    const salt = new Uint8Array(16);
    for (let i = 0; i < 16; i++) salt[i] = saltBin.charCodeAt(i);
    return { iterations, salt, hashB64: parts[3] };
  } catch {
    return null;
  }
};

export const verifyPbkdf2 = async (password: string, encoded: string): Promise<boolean> => {
  const parsed = parsePbkdf2(encoded);
  if (!parsed) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: parsed.salt as BufferSource,
      iterations: parsed.iterations,
    },
    key,
    256,
  );
  return safeEqual(bytesToBase64(new Uint8Array(bits)), parsed.hashB64);
};

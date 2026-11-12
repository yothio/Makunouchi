export type TokenRole = "host" | "screen";

export type TokenIo = {
  search: string;
  pathname: string;
  hash: string;
  /** sessionStorage が使えないとき null（トークンはメモリのみ）。 */
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  replaceUrl(url: string): void;
};

export const tokenStorageKey = (role: TokenRole, sessionId: string): string => {
  return `makunouchi:${sessionId}:${role}Token`;
};

/** Persist a host/screen token under the shared key (used by URL capture and ID/password login). */
export const storeToken = (
  role: TokenRole,
  sessionId: string,
  token: string,
  storage: Pick<Storage, "setItem"> | null,
): void => {
  try {
    storage?.setItem(tokenStorageKey(role, sessionId), token);
  } catch {
  }
};

export const clearStoredToken = (
  role: TokenRole,
  sessionId: string,
  storage: Pick<Storage, "removeItem"> | null,
): void => {
  try {
    storage?.removeItem(tokenStorageKey(role, sessionId));
  } catch {
  }
};

/**
 * The host / screen token is a credential and the projector shows the URL bar: move it from the query string
 * into sessionStorage (so a reload still works) and strip it from the address. Host and screen keep separate keys.
 * If storage is unavailable the token only lives for this page load.
 */
export const resolveToken = (role: TokenRole, sessionId: string, io: TokenIo): string => {
  const key = tokenStorageKey(role, sessionId);
  const params = new URLSearchParams(io.search);
  const fromUrl = params.get("token");
  if (fromUrl) {
    storeToken(role, sessionId, fromUrl, io.storage);
    params.delete("token");
    const qs = params.toString();
    io.replaceUrl(io.pathname + (qs ? `?${qs}` : "") + io.hash);
    return fromUrl;
  }
  try {
    return io.storage?.getItem(key) ?? "";
  } catch {
    return "";
  }
};

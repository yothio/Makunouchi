export type TokenRole = "host" | "screen";

export type TokenIo = {
  search: string;
  pathname: string;
  hash: string;
  /** null when storage is unavailable (private window, blocked site data). */
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  replaceUrl(url: string): void;
};

/**
 * The host / screen token is a credential and the projector shows the URL bar: move it from the query string
 * into sessionStorage (so a reload still works) and strip it from the address. Host and screen keep separate keys.
 * If storage is unavailable the token only lives for this page load.
 */
export const resolveToken = (role: TokenRole, sessionId: string, io: TokenIo): string => {
  const key = `makunouchi:${sessionId}:${role}Token`;
  const params = new URLSearchParams(io.search);
  const fromUrl = params.get("token");
  if (fromUrl) {
    try {
      io.storage?.setItem(key, fromUrl);
    } catch {
      // storage unavailable
    }
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

import type { ServerMessage } from "../../shared/types";

export type TokenStore = {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
};

export const playerTokenKey = (sessionId: string) => `makunouchi:${sessionId}:playerToken`;

/** localStorage wrapped so private-mode / in-app browsers that throw don't break the app. */
export const localTokenStore: TokenStore = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      // ignore
    }
  },
  remove(k) {
    try {
      localStorage.removeItem(k);
    } catch {
      // ignore
    }
  },
};

const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export const buildGuestUrl = (
  loc: { protocol: string; host: string },
  sessionId: string,
  store: TokenStore,
): string => {
  const scheme = loc.protocol === "https:" ? "wss" : "ws";
  const base = `${scheme}://${loc.host}/ws/${encodeURIComponent(sessionId)}/guest`;
  const token = safe(() => store.get(playerTokenKey(sessionId)), null);
  return token ? `${base}?playerToken=${encodeURIComponent(token)}` : base;
};

export const handleGuestMessage = (sessionId: string, msg: ServerMessage, store: TokenStore): void => {
  const key = playerTokenKey(sessionId);
  if (msg.type === "need_join") safe(() => store.remove(key), undefined);
  else if (msg.type === "joined") safe(() => store.set(key, msg.playerToken), undefined);
};

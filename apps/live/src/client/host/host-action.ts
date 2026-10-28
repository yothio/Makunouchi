import type { HostView } from "../../shared/types";

/** Label of the single progress button, or null when no button should be shown. */
export function hostActionLabel(view: HostView): string | null {
  const s = view.screen;
  switch (s.kind) {
    case "lobby":
      return "スタート";
    case "question":
      return s.status === "open" ? "回答を締め切る" : "正解を発表";
    case "reveal":
      return s.isLast ? "結果発表へ" : "次の問題へ";
    case "list":
      return s.nextRank === null ? null : `${s.nextRank} 位を発表`;
    case "podium":
      if (!s.revealed) return "めくる";
      return s.nextRank === null ? null : `${s.nextRank} 位へ`;
  }
}

/** topN is not in HostView, so the header is derived from the listed entries. */
export function listHeader<T extends { rank: number }>(entries: readonly T[]): string {
  if (entries.length === 0) return "4 位以下はいません";
  const ranks = entries.map((e) => e.rank);
  return `${Math.min(...ranks)} 位〜${Math.max(...ranks)} 位`;
}

export function buildHostUrl(
  loc: { protocol: string; host: string },
  sessionId: string,
  token: string,
): string {
  const scheme = loc.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${loc.host}/ws/${encodeURIComponent(sessionId)}/host?token=${encodeURIComponent(token)}`;
}

export const ADVANCE_LOCK_MS = 3000;

/**
 * Whether the advance button should stay locked after a click. Unlocks when the phase changed,
 * the socket dropped (the advance may have been lost), or the timeout elapsed.
 * Resending is safe: the server dedupes on `from`.
 */
export function isAdvanceLocked(
  sent: { from: string; at: number } | null,
  phaseKey: string,
  connected: boolean,
  now: number,
): boolean {
  if (!sent || !connected) return false;
  if (sent.from !== phaseKey) return false;
  return now - sent.at < ADVANCE_LOCK_MS;
}

/** After the phase changes, ignore advance input for a while so a double-click can't skip a screen. */
export const ADVANCE_COOLDOWN_MS = 1000;

export function isInCooldown(phaseChangedAt: number | null, now: number): boolean {
  return phaseChangedAt !== null && now - phaseChangedAt < ADVANCE_COOLDOWN_MS;
}

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
  return `4 位〜${Math.max(...entries.map((e) => e.rank))} 位`;
}

export function buildHostUrl(
  loc: { protocol: string; host: string },
  sessionId: string,
  token: string,
): string {
  const scheme = loc.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${loc.host}/ws/${encodeURIComponent(sessionId)}/host?token=${encodeURIComponent(token)}`;
}

/** The list header is derived from the listed entries; with several pages it also shows which page this is. */
export const listHeader = <T extends { rank: number }>(entries: readonly T[], page = 0, pageCount = 1): string => {
  if (entries.length === 0) return "4 位以下はいません";
  const ranks = entries.map((e) => e.rank);
  const range = `${Math.min(...ranks)} 位〜${Math.max(...ranks)} 位`;
  return pageCount >= 2 ? `${range}（${page + 1}/${pageCount}）` : range;
};

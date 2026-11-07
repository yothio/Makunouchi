/** The list header is derived from the listed entries. */
export const listHeader = <T extends { rank: number }>(entries: readonly T[]): string => {
  if (entries.length === 0) return "4 位以下はいません";
  const ranks = entries.map((e) => e.rank);
  return `${Math.min(...ranks)} 位〜${Math.max(...ranks)} 位`;
};

import type { ScreenOf } from "./types";
import { useFitToBox } from "./useFitToBox";

/** Ranking page whose font size and columns are computed to fit the box; see `useFitToBox`. */
export const FittedList = ({ entries }: { entries: ScreenOf<"list">["entries"] }) => {
  const ref = useFitToBox(entries.length);

  return (
    <ol ref={ref} className="host-list host-list-grid">
      {entries.map((e) => (
        <li key={`${e.rank}:${e.nickname}`}>
          <span className="host-rank">{e.rank} 位</span>
          <span className="host-name">{e.nickname}</span>
          <span className="host-score">{e.score} 点</span>
        </li>
      ))}
    </ol>
  );
};

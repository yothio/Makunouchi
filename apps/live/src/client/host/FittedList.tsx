import type { HostScreenOf } from "./types";
import { useFitToBox } from "./useFitToBox";

/** Ranking list that never silently clips; see `useFitToBox` for the fitting strategy. */
export const FittedList = ({ entries }: { entries: HostScreenOf<"list">["entries"] }) => {
  const ref = useFitToBox(entries);

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

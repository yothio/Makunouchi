import type { HostScreenOf } from "../types";

export const PodiumScreen = ({ screen: s }: { screen: HostScreenOf<"podium"> }) => {
  return (
    <div className="host-podium">
      <h1 className="host-title">{s.rank} 位</h1>
      {s.revealed ? (
        <ul className="host-list">
          {s.players.map((p, i) => (
            <li key={i}>
              <span className="host-name">{p.nickname}</span>
              <span className="host-score">{p.score} 点</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="host-hidden">？？？</p>
      )}
    </div>
  );
};

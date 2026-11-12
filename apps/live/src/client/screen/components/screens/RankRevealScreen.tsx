import type { ScreenOf } from "@client/screen/types";

export const RankRevealScreen = ({ screen }: { screen: ScreenOf<"rank_reveal"> }) => {
  return (
    <div className="host-rank-reveal">
      {screen.rank !== null && <p className="host-rank-big">{screen.rank} 位</p>}
      {screen.nickname !== null && <p className="host-name-big">{screen.nickname}</p>}
    </div>
  );
};

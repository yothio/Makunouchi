import type { ScreenView } from "@shared/types";
import { LobbyScreen } from "./screens/LobbyScreen";
import { QuestionScreen } from "./screens/QuestionScreen";
import { RankRevealScreen } from "./screens/RankRevealScreen";
import { ResultsWaitScreen } from "./screens/ResultsWaitScreen";
import { RevealScreen } from "./screens/RevealScreen";

export const ScreenContent = ({ view, sessionId }: { view: ScreenView | null; sessionId: string }) => {
  if (!view) return <p className="host-wait">接続中…</p>;
  switch (view.kind) {
    case "lobby":
      return <LobbyScreen title={view.title} playerCount={view.playerCount} sessionId={sessionId} />;
    case "question":
      return <QuestionScreen screen={view} />;
    case "reveal":
      return <RevealScreen screen={view} />;
    case "results_wait":
      return <ResultsWaitScreen title={view.title} />;
    case "rank_reveal":
      return <RankRevealScreen screen={view} />;
  }
};

import type { ScreenView } from "../../shared/types";
import { FittedList } from "./FittedList";
import { listHeader } from "./list-header";
import { LobbyScreen } from "./screens/LobbyScreen";
import { PodiumScreen } from "./screens/PodiumScreen";
import { QuestionScreen } from "./screens/QuestionScreen";
import { RevealScreen } from "./screens/RevealScreen";

/** Picks the projector screen for a ScreenView. */
export const ScreenContent = ({ view, sessionId }: { view: ScreenView | null; sessionId: string }) => {
  if (!view) return <p className="host-wait">接続中…</p>;
  switch (view.kind) {
    case "lobby":
      return <LobbyScreen title={view.title} playerCount={view.playerCount} sessionId={sessionId} />;
    case "question":
      return <QuestionScreen screen={view} />;
    case "reveal":
      return <RevealScreen screen={view} />;
    case "list":
      return (
        <div>
          <h1 className="host-title">{listHeader(view.entries, view.page, view.pageCount)}</h1>
          <FittedList entries={view.entries} />
        </div>
      );
    case "podium":
      return <PodiumScreen screen={view} />;
  }
};

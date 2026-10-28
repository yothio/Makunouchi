import type { HostView } from "../../shared/types";
import { FittedList } from "./FittedList";
import { listHeader } from "./host-action";
import { LobbyScreen } from "./screens/LobbyScreen";
import { PodiumScreen } from "./screens/PodiumScreen";
import { QuestionScreen } from "./screens/QuestionScreen";
import { RevealScreen } from "./screens/RevealScreen";

export const HostScreen = ({ view, sessionId }: { view: HostView | null; sessionId: string }) => {
  if (!view) return <p className="host-wait">接続中…</p>;
  const s = view.screen;
  switch (s.kind) {
    case "lobby":
      return <LobbyScreen title={view.title} playerCount={view.playerCount} sessionId={sessionId} />;
    case "question":
      return <QuestionScreen screen={s} playerCount={view.playerCount} />;
    case "reveal":
      return <RevealScreen screen={s} />;
    case "list":
      return (
        <div>
          <h1 className="host-title">{listHeader(s.entries)}</h1>
          <FittedList entries={s.entries} />
        </div>
      );
    case "podium":
      return <PodiumScreen screen={s} />;
  }
};

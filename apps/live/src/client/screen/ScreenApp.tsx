import { ScreenContent } from "./ScreenContent";
import { useScreenSession } from "./useScreenSession";

export const ScreenApp = ({ sessionId, token }: { sessionId: string; token: string }) => {
  const { view, connected } = useScreenSession(sessionId, token);

  return (
    <div className="host">
      {!connected && <div className="host-banner">再接続中…</div>}
      <main className="host-main">
        <ScreenContent view={view} sessionId={sessionId} />
      </main>
    </div>
  );
};

import { screenPermanentErrorMessage } from "@client/common/lib/permanent-ws-error";
import { ScreenContent } from "./ScreenContent";
import { useScreenSession } from "./useScreenSession";

export const ScreenApp = ({ sessionId, token }: { sessionId: string; token: string }) => {
  const { view, connected, permanentError } = useScreenSession(sessionId, token);

  return (
    <div className="host">
      {permanentError ? (
        <div className="host-banner" role="alert">
          {screenPermanentErrorMessage(permanentError)}
        </div>
      ) : (
        !connected && <div className="host-banner">再接続中…</div>
      )}
      <main className="host-main">
        <ScreenContent view={view} sessionId={sessionId} />
      </main>
    </div>
  );
};

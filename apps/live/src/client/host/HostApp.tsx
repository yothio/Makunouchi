import { HostScreen } from "./HostScreen";
import { useHostSession } from "./useHostSession";

export const HostApp = ({ sessionId, token }: { sessionId: string; token: string }) => {
  const { view, connected, label, canAdvance, advance } = useHostSession(sessionId, token);

  return (
    <div className="host">
      {!connected && <div className="host-banner">再接続中…</div>}
      <main className="host-main">
        <HostScreen view={view} sessionId={sessionId} />
      </main>
      {label && (
        <button type="button" className="host-advance" disabled={!canAdvance} onClick={advance}>
          {label}
        </button>
      )}
    </div>
  );
};

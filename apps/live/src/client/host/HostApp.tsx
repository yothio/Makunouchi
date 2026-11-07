import { HostPanel } from "./HostPanel";
import { useHostSession } from "./useHostSession";

export const HostApp = ({ sessionId, token }: { sessionId: string; token: string }) => {
  const { view, connected, label, canAdvance, advance, sendResultsAction, resultsLocked } = useHostSession(
    sessionId,
    token,
  );

  return (
    <div className="host">
      {!connected && <div className="host-banner">再接続中…</div>}
      <main className="host-main">
        <HostPanel view={view} resultsLocked={resultsLocked} onResultsAction={sendResultsAction} />
      </main>
      {label && (
        <button type="button" className="host-advance" disabled={!canAdvance} onClick={advance}>
          {label}
        </button>
      )}
    </div>
  );
};

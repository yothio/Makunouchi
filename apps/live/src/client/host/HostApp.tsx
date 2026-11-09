import { hostPermanentErrorMessage } from "../permanent-ws-error";
import { shouldOfferRelogin } from "./open-failure-counter";
import { HostPanel } from "./HostPanel";
import { useHostSession } from "./useHostSession";

export const HostApp = ({
  sessionId,
  token,
  onRelogin,
}: {
  sessionId: string;
  token: string;
  onRelogin?: () => void;
}) => {
  const {
    view,
    connected,
    neverOpened,
    permanentError,
    label,
    canAdvance,
    advance,
    sendResultsAction,
    resultsLocked,
  } = useHostSession(sessionId, token);
  const offerRelogin = !permanentError && Boolean(onRelogin) && shouldOfferRelogin({ neverOpened });

  return (
    <div className="host">
      {permanentError ? (
        <div className="host-banner" role="alert">
          {hostPermanentErrorMessage(permanentError)}
        </div>
      ) : (
        !connected && <div className="host-banner">再接続中…</div>
      )}
      {offerRelogin && (
        <div className="host-banner">
          接続できません。
          <button type="button" className="host-relogin" onClick={onRelogin}>
            ログインし直す
          </button>
        </div>
      )}
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

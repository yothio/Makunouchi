import { guestPermanentErrorMessage } from "../permanent-ws-error";
import { GuestScreen } from "./GuestScreen";
import { useGuestSession } from "./useGuestSession";

export const GuestApp = ({ sessionId }: { sessionId: string }) => {
  const { view, needJoin, joinError, pending, connected, permanentError, answer, join } =
    useGuestSession(sessionId);

  return (
    <div className="guest">
      {permanentError ? (
        <div className="banner" role="alert">
          {guestPermanentErrorMessage(permanentError)}
        </div>
      ) : (
        !connected && (
          <div className="banner" role="status">
            再接続中…
          </div>
        )
      )}
      <main className="guest-main">
        <GuestScreen
          view={view}
          needJoin={needJoin}
          joinError={joinError}
          pending={pending}
          disabled={!connected}
          onAnswer={answer}
          onJoin={join}
        />
      </main>
    </div>
  );
};

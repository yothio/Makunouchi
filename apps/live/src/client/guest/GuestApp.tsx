import { GuestScreen } from "./GuestScreen";
import { useGuestSession } from "./useGuestSession";

export const GuestApp = ({ sessionId }: { sessionId: string }) => {
  const { view, needJoin, joinError, pending, connected, answer, join } = useGuestSession(sessionId);

  return (
    <div className="guest">
      {!connected && (
        <div className="banner" role="status">
          再接続中…
        </div>
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

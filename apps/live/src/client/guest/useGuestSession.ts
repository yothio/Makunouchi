import { useState } from "react";
import type { Choice, GuestView } from "../../shared/types";
import { permanentWsErrorFromCode, type PermanentWsError } from "../permanent-ws-error";
import { useLiveSocket } from "../use-live-socket";
import { buildGuestUrl, handleGuestMessage, localTokenStore } from "./guest-socket";
import type { JoinError, PendingAnswer } from "./types";

export const useGuestSession = (sessionId: string) => {
  const [view, setView] = useState<GuestView | null>(null);
  const [needJoin, setNeedJoin] = useState(false);
  const [joinError, setJoinError] = useState<JoinError | null>(null);
  const [pending, setPending] = useState<PendingAnswer | null>(null);
  const [permanentError, setPermanentError] = useState<PermanentWsError | null>(null);

  const { send, connected } = useLiveSocket(
    () => buildGuestUrl(window.location, sessionId, localTokenStore),
    {
      onMessage: (msg) => {
        handleGuestMessage(sessionId, msg, localTokenStore);
        if (msg.type === "guest_view") {
          setView(msg.view);
          setNeedJoin(false);
          setJoinError(null);
          setPending(null);
        } else if (msg.type === "need_join") {
          setView(null);
          setNeedJoin(true);
        } else if (msg.type === "join_error") {
          setJoinError(msg.reason);
        }
      },
      onPermanentClose: (code) => {
        const error = permanentWsErrorFromCode(code);
        if (error) setPermanentError(error);
      },
    },
  );

  const answer = (questionIndex: number, choice: Choice) => {
    setPending({ index: questionIndex, choice });
    send({ type: "answer", questionIndex, choice });
  };
  const join = (nickname: string) => send({ type: "join", nickname });

  return { view, needJoin, joinError, pending, connected, permanentError, answer, join };
};

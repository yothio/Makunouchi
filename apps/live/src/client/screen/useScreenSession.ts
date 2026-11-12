import { useState } from "react";
import type { ScreenView } from "@shared/types";
import { permanentWsErrorFromCode, type PermanentWsError } from "@client/permanent-ws-error";
import { buildSocketUrl } from "@client/socket-url";
import { useLiveSocket } from "@client/use-live-socket";

export const useScreenSession = (sessionId: string, token: string) => {
  const [view, setView] = useState<ScreenView | null>(null);
  const [permanentError, setPermanentError] = useState<PermanentWsError | null>(null);
  const { connected } = useLiveSocket(() => buildSocketUrl(window.location, "screen", sessionId, token), {
    onMessage: (msg) => {
      if (msg.type === "screen_view") setView(msg.view);
    },
    onPermanentClose: (code) => {
      const error = permanentWsErrorFromCode(code);
      if (error) setPermanentError(error);
    },
  });
  return { view, connected, permanentError };
};

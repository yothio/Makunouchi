import { useState } from "react";
import type { ScreenView } from "../../shared/types";
import { buildSocketUrl } from "../socket-url";
import { useLiveSocket } from "../use-live-socket";

/** Follows the host: the projector only receives screen_view and never sends anything. */
export const useScreenSession = (sessionId: string, token: string) => {
  const [view, setView] = useState<ScreenView | null>(null);
  const { connected } = useLiveSocket(() => buildSocketUrl(window.location, "screen", sessionId, token), {
    onMessage: (msg) => {
      if (msg.type === "screen_view") setView(msg.view);
    },
  });
  return { view, connected };
};

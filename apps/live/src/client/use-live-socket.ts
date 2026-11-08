import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "../shared/types";
import { createReconnectingSocket, type ReconnectingSocket } from "./reconnecting-socket";

export type UseLiveSocketOptions = {
  /** Called synchronously for every message (never batched away like `last`). */
  onMessage?: (msg: ServerMessage) => void;
  /** Opt-in never-opened failure counter (host relogin path). */
  onNeverOpened?: (failures: number) => void;
};

export type LiveSocket = {
  last: ServerMessage | null;
  send(msg: ClientMessage): void;
  connected: boolean;
  forceReconnect(): void;
};

/**
 * `url` may be a function; it is re-evaluated on each (re)connect attempt.
 * The socket is created once per component mount.
 */
export const useLiveSocket = (
  url: string | (() => string),
  options: UseLiveSocketOptions = {},
): LiveSocket => {
  const [last, setLast] = useState<ServerMessage | null>(null);
  const [connected, setConnected] = useState(false);
  const sockRef = useRef<ReconnectingSocket | null>(null);
  // Capture opt-in once at mount so guests/screens never arm the never-opened path.
  const neverOpenedEnabledRef = useRef(Boolean(options.onNeverOpened));
  // Always call the latest url / onMessage without re-creating the socket when their identity changes.
  const getUrl = useEffectEvent(() => (typeof url === "function" ? url() : url));
  const onMessage = useEffectEvent((m: ServerMessage) => options.onMessage?.(m));
  const onNeverOpened = useEffectEvent((failures: number) => options.onNeverOpened?.(failures));

  useEffect(() => {
    const sock = createReconnectingSocket({
      getUrl: () => getUrl(),
      onMessage: (m) => {
        onMessage(m);
        setLast(m);
      },
      onStatus: setConnected,
      ...(neverOpenedEnabledRef.current
        ? { onNeverOpened: (failures: number) => onNeverOpened(failures) }
        : {}),
    });
    sockRef.current = sock;
    const onVisible = () => {
      if (document.visibilityState === "visible") sock.reconnectNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      sock.close();
      sockRef.current = null;
    };
  }, []);

  const send = useCallback((msg: ClientMessage) => sockRef.current?.send(msg), []);
  const forceReconnect = useCallback(() => sockRef.current?.forceReconnect(), []);
  return { last, send, connected, forceReconnect };
};

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "../shared/types";
import { createReconnectingSocket, type ReconnectingSocket } from "./reconnecting-socket";

export type UseLiveSocketOptions = {
  /** Called synchronously for every message (never batched away like `last`). */
  onMessage?: (msg: ServerMessage) => void;
};

/**
 * `url` may be a function; it is re-evaluated on each (re)connect attempt.
 * The socket is created once per component mount.
 */
export function useLiveSocket(
  url: string | (() => string),
  options: UseLiveSocketOptions = {},
): { last: ServerMessage | null; send(msg: ClientMessage): void; connected: boolean } {
  const [last, setLast] = useState<ServerMessage | null>(null);
  const [connected, setConnected] = useState(false);
  const sockRef = useRef<ReconnectingSocket | null>(null);
  const urlRef = useRef(url);
  const onMessageRef = useRef(options.onMessage);
  urlRef.current = url;
  onMessageRef.current = options.onMessage;

  useEffect(() => {
    const sock = createReconnectingSocket({
      getUrl: () => (typeof urlRef.current === "function" ? urlRef.current() : urlRef.current),
      onMessage: (m) => {
        onMessageRef.current?.(m);
        setLast(m);
      },
      onStatus: setConnected,
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
  return { last, send, connected };
}

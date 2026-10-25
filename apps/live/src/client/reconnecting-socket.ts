import type { ClientMessage, ServerMessage } from "../shared/types";

const MIN_DELAY = 500;
const MAX_DELAY = 5000;

export type ReconnectingSocketOptions = {
  /** Called on every connection attempt so the URL can change between attempts. */
  getUrl: () => string;
  onMessage: (msg: ServerMessage) => void;
  onStatus: (connected: boolean) => void;
  WebSocketImpl?: typeof WebSocket;
};

export type ReconnectingSocket = {
  send(msg: ClientMessage): void;
  /** Reconnect immediately if currently disconnected (e.g. tab became visible). */
  reconnectNow(): void;
  close(): void;
};

export function createReconnectingSocket(opts: ReconnectingSocketOptions): ReconnectingSocket {
  const Impl = opts.WebSocketImpl ?? WebSocket;
  let ws: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let delay = MIN_DELAY;
  let closed = false;

  function connect() {
    timer = null;
    if (closed) return;
    const sock = new Impl(opts.getUrl());
    ws = sock;
    sock.onopen = () => {
      if (ws !== sock) return;
      delay = MIN_DELAY;
      opts.onStatus(true);
    };
    sock.onmessage = (e) => {
      if (ws !== sock) return;
      try {
        opts.onMessage(JSON.parse(String(e.data)) as ServerMessage);
      } catch {
        // ignore malformed frames
      }
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      opts.onStatus(false);
      if (closed) return;
      timer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, MAX_DELAY);
    };
  }

  connect();

  return {
    send(msg) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
    },
    reconnectNow() {
      if (closed || ws) return; // connected or connecting
      if (timer) clearTimeout(timer);
      connect();
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      const sock = ws;
      ws = null;
      sock?.close();
    },
  };
}

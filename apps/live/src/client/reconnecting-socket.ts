import type { ClientMessage, ServerMessage } from "../shared/types";

const MIN_DELAY = 500;
const MAX_DELAY = 5000;
/** Heartbeat: a half-open socket (Wi-Fi dropped, no FIN) never fires onclose, so we probe it ourselves. */
const PING_INTERVAL = 10_000;
const STALE_AFTER = 25_000;
/** On tab return, an open socket silent for longer than this is treated as dead. */
const SILENT_ON_RETURN = 10_000;
const CONNECT_TIMEOUT = 5000;

export type ReconnectingSocketOptions = {
  /** Called on every connection attempt so the URL can change between attempts. */
  getUrl: () => string;
  onMessage: (msg: ServerMessage) => void;
  onStatus: (connected: boolean) => void;
  WebSocketImpl?: typeof WebSocket;
};

export type ReconnectingSocket = {
  send(msg: ClientMessage): void;
  /** Reconnect immediately if disconnected, stuck connecting, or open but silent (e.g. tab became visible). */
  reconnectNow(): void;
  /** Drop the current connection (even if it looks open) and reconnect immediately. */
  forceReconnect(): void;
  close(): void;
};

export const createReconnectingSocket = (opts: ReconnectingSocketOptions): ReconnectingSocket => {
  const Impl = opts.WebSocketImpl ?? WebSocket;
  let ws: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;
  let staleTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let lastReceived = 0;
  let delay = MIN_DELAY;
  let closed = false;

  const clearConnTimers = () => {
    if (connectTimer) clearTimeout(connectTimer);
    if (staleTimer) clearTimeout(staleTimer);
    if (pingTimer) clearInterval(pingTimer);
    connectTimer = staleTimer = pingTimer = null;
  };

  /** Tear down `sock` without waiting for its (possibly never-arriving) close event. */
  const drop = (sock: WebSocket, reconnectAfter: number | null) => {
    if (ws !== sock) return;
    ws = null;
    clearConnTimers();
    sock.onopen = sock.onmessage = sock.onclose = null;
    try {
      sock.close();
    } catch {
      // already dead
    }
    opts.onStatus(false);
    if (closed) return;
    if (reconnectAfter === null) {
      connect();
    } else {
      timer = setTimeout(connect, reconnectAfter);
      delay = Math.min(delay * 2, MAX_DELAY);
    }
  };

  const armStale = (sock: WebSocket) => {
    if (staleTimer) clearTimeout(staleTimer);
    staleTimer = setTimeout(() => drop(sock, delay), STALE_AFTER);
  };

  const connect = () => {
    timer = null;
    if (closed) return;
    const sock = new Impl(opts.getUrl());
    ws = sock;
    connectTimer = setTimeout(() => drop(sock, delay), CONNECT_TIMEOUT);
    sock.onopen = () => {
      if (ws !== sock) return;
      delay = MIN_DELAY;
      if (connectTimer) clearTimeout(connectTimer);
      connectTimer = null;
      lastReceived = Date.now();
      armStale(sock);
      pingTimer = setInterval(() => {
        try {
          sock.send("ping");
        } catch {
          // the stale timer will recycle the socket
        }
      }, PING_INTERVAL);
      opts.onStatus(true);
    };
    sock.onmessage = (e) => {
      if (ws !== sock) return;
      lastReceived = Date.now();
      armStale(sock);
      const data = String(e.data);
      if (data === "pong") return; // heartbeat reply, not an app message
      try {
        opts.onMessage(JSON.parse(data) as ServerMessage);
      } catch {
        // ignore malformed frames
      }
    };
    sock.onclose = () => drop(sock, delay);
  };

  connect();

  return {
    send(msg) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
    },
    reconnectNow() {
      if (closed) return;
      if (!ws) {
        if (timer) clearTimeout(timer);
        connect();
      } else if (ws.readyState !== 1 || Date.now() - lastReceived > SILENT_ON_RETURN) {
        drop(ws, null);
      }
    },
    forceReconnect() {
      if (closed) return;
      if (ws) drop(ws, null);
      else {
        if (timer) clearTimeout(timer);
        connect();
      }
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      clearConnTimers();
      const sock = ws;
      ws = null;
      if (sock) {
        sock.onopen = sock.onmessage = sock.onclose = null;
        sock.close();
      }
    },
  };
};

import type { ClientMessage, ServerMessage } from "@shared/types";
import { isPermanentWsClose } from "@shared/ws-close";

const MIN_DELAY = 500;
const MAX_DELAY = 5000;
/** Heartbeat: a half-open socket (Wi-Fi dropped, no FIN) never fires onclose, so we probe it ourselves. */
const PING_INTERVAL = 10_000;
const STALE_AFTER = 25_000;
/** On tab return, an open socket silent for longer than this is treated as dead. */
const SILENT_ON_RETURN = 10_000;
const CONNECT_TIMEOUT = 5000;

export type ReconnectingSocketOptions = {
  getUrl: () => string;
  onMessage: (msg: ServerMessage) => void;
  onStatus: (connected: boolean) => void;
  /**
   * Opt-in: called when a connection attempt ends without ever opening, with the consecutive
   * never-opened failure count (resets to 0 after any successful open). Guests/screens omit this.
   * Not called for permanent close codes (4404 / 4401); those use onPermanentClose instead.
   */
  onNeverOpened?: (failures: number) => void;
  /** Called once when the server closes with a permanent application code; no further reconnects. */
  onPermanentClose?: (code: number) => void;
  WebSocketImpl?: typeof WebSocket;
};

export type ReconnectingSocket = {
  send(msg: ClientMessage): void;
  reconnectNow(): void;
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
  let neverOpenedFailures = 0;
  let currentOpened = false;

  const clearConnTimers = () => {
    if (connectTimer) clearTimeout(connectTimer);
    if (staleTimer) clearTimeout(staleTimer);
    if (pingTimer) clearInterval(pingTimer);
    connectTimer = staleTimer = pingTimer = null;
  };

  const drop = (sock: WebSocket, reconnectAfter: number | null) => {
    if (ws !== sock) return;
    const opened = currentOpened;
    ws = null;
    currentOpened = false;
    clearConnTimers();
    sock.onopen = sock.onmessage = sock.onclose = null;
    try {
      sock.close();
    } catch {
    }
    opts.onStatus(false);
    if (!opened && !closed) {
      neverOpenedFailures += 1;
      opts.onNeverOpened?.(neverOpenedFailures);
    }
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
    currentOpened = false;
    connectTimer = setTimeout(() => drop(sock, delay), CONNECT_TIMEOUT);
    sock.onopen = () => {
      if (ws !== sock) return;
      currentOpened = true;
      neverOpenedFailures = 0;
      delay = MIN_DELAY;
      if (connectTimer) clearTimeout(connectTimer);
      connectTimer = null;
      lastReceived = Date.now();
      armStale(sock);
      pingTimer = setInterval(() => {
        try {
          sock.send("ping");
        } catch {
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
      }
    };
    sock.onclose = (event) => {
      if (ws !== sock) return;
      if (isPermanentWsClose(event.code)) {
        closed = true;
        ws = null;
        currentOpened = false;
        clearConnTimers();
        sock.onopen = sock.onmessage = sock.onclose = null;
        opts.onStatus(false);
        opts.onPermanentClose?.(event.code);
        return;
      }
      drop(sock, delay);
    };
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

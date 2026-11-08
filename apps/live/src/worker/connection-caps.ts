import { MAX_MESSAGE_BYTES, MAX_WEBSOCKETS } from "./game/rules";

/** Only live sockets count; CLOSING/CLOSED are ignored so Wi-Fi blips do not inflate the cap. */
export const countsTowardConnectionCap = (readyState: number): boolean => {
  return readyState === WebSocket.CONNECTING || readyState === WebSocket.OPEN;
};

export const activeWebSocketCount = (sockets: readonly { readyState: number }[]): number => {
  return sockets.filter((ws) => countsTowardConnectionCap(ws.readyState)).length;
};

export const isGuestAtConnectionCap = (
  role: string,
  sockets: readonly { readyState: number }[],
): boolean => {
  return role === "guest" && activeWebSocketCount(sockets) >= MAX_WEBSOCKETS;
};

export const inboundByteLength = (raw: string | ArrayBuffer): number => {
  return typeof raw === "string" ? new TextEncoder().encode(raw).byteLength : raw.byteLength;
};

export const isInboundMessageTooLarge = (raw: string | ArrayBuffer): boolean => {
  return inboundByteLength(raw) > MAX_MESSAGE_BYTES;
};

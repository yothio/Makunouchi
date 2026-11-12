import { describe, expect, test } from "vitest";
import {
  activeWebSocketCount,
  countsTowardConnectionCap,
  inboundByteLength,
  isGuestAtConnectionCap,
  isInboundMessageTooLarge,
} from "@worker/connection-caps";
import { MAX_MESSAGE_BYTES, MAX_WEBSOCKETS } from "@worker/game/rules";

describe("countsTowardConnectionCap", () => {
  test("OPEN と CONNECTING だけ数える（CLOSING / CLOSED は除外）", () => {
    expect(countsTowardConnectionCap(WebSocket.CONNECTING)).toBe(true);
    expect(countsTowardConnectionCap(WebSocket.OPEN)).toBe(true);
    expect(countsTowardConnectionCap(WebSocket.CLOSING)).toBe(false);
    expect(countsTowardConnectionCap(WebSocket.CLOSED)).toBe(false);
  });
});

describe("activeWebSocketCount / isGuestAtConnectionCap", () => {
  test("閉じかけ・閉鎖済みを除いた本数で上限判定する", () => {
    const sockets = [
      { readyState: WebSocket.OPEN },
      { readyState: WebSocket.OPEN },
      { readyState: WebSocket.CLOSING },
      { readyState: WebSocket.CLOSED },
    ];
    expect(activeWebSocketCount(sockets)).toBe(2);
    const atCap = Array.from({ length: MAX_WEBSOCKETS }, () => ({ readyState: WebSocket.OPEN }));
    expect(isGuestAtConnectionCap("guest", atCap)).toBe(true);
    expect(isGuestAtConnectionCap("guest", [...atCap, { readyState: WebSocket.CLOSING }])).toBe(true);
    expect(isGuestAtConnectionCap("guest", atCap.slice(0, -1))).toBe(false);
    expect(isGuestAtConnectionCap("host", atCap)).toBe(false);
    expect(isGuestAtConnectionCap("screen", atCap)).toBe(false);
  });
});

describe("inbound message size", () => {
  test("string は UTF-8 バイト数、ArrayBuffer は byteLength で判定する", () => {
    expect(inboundByteLength("abc")).toBe(3);
    expect(inboundByteLength("あ")).toBe(3);
    expect(inboundByteLength(new ArrayBuffer(10))).toBe(10);
    expect(isInboundMessageTooLarge("x".repeat(MAX_MESSAGE_BYTES))).toBe(false);
    expect(isInboundMessageTooLarge("x".repeat(MAX_MESSAGE_BYTES + 1))).toBe(true);
    expect(isInboundMessageTooLarge(new ArrayBuffer(MAX_MESSAGE_BYTES))).toBe(false);
    expect(isInboundMessageTooLarge(new ArrayBuffer(MAX_MESSAGE_BYTES + 1))).toBe(true);
  });
});

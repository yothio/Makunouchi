import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createReconnectingSocket } from "../../src/client/reconnecting-socket";
import {
  buildGuestUrl,
  handleGuestMessage,
  playerTokenKey,
  type TokenStore,
} from "../../src/client/guest/guest-socket";
import type { ServerMessage } from "../../src/shared/types";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
  receiveRaw(data: string) {
    this.onmessage?.({ data });
  }
  receive(m: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}

function memoryStore(): TokenStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get: (k) => map.get(k) ?? null,
    set: (k, v) => void map.set(k, v),
    remove: (k) => void map.delete(k),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
});
afterEach(() => vi.useRealTimers());

const make = (getUrl: () => string = () => "ws://x/a") => {
  const messages: ServerMessage[] = [];
  const statuses: boolean[] = [];
  const s = createReconnectingSocket({
    getUrl,
    onMessage: (m) => messages.push(m),
    onStatus: (c) => statuses.push(c),
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
  });
  return { s, messages, statuses };
};
const last = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;

describe("createReconnectingSocket", () => {
  test("切断後 0.5s, 1s, 2s ... と再接続し、5s を超えない", () => {
    make();
    expect(FakeWebSocket.instances).toHaveLength(1);
    const delays: number[] = [];
    for (let i = 0; i < 7; i++) {
      const before = FakeWebSocket.instances.length;
      last().drop();
      // find the delay: step 100ms until a new socket appears
      let waited = 0;
      while (FakeWebSocket.instances.length === before) {
        vi.advanceTimersByTime(100);
        waited += 100;
        expect(waited).toBeLessThanOrEqual(6000);
      }
      delays.push(waited);
    }
    expect(delays).toEqual([500, 1000, 2000, 4000, 5000, 5000, 5000]);
  });

  test("接続成功でバックオフが 0.5s に戻り、connected が通知される", () => {
    const { statuses } = make();
    last().drop();
    vi.advanceTimersByTime(500);
    last().drop();
    vi.advanceTimersByTime(1000);
    last().open();
    expect(statuses.at(-1)).toBe(true);
    last().drop();
    expect(statuses.at(-1)).toBe(false);
    vi.advanceTimersByTime(499);
    expect(FakeWebSocket.instances).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(4);
  });

  test("再接続のたびに URL を再計算する", () => {
    let n = 0;
    make(() => `ws://x/a?n=${n++}`);
    last().drop();
    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances.map((i) => i.url)).toEqual(["ws://x/a?n=0", "ws://x/a?n=1"]);
  });

  test("reconnectNow は待機中なら即再接続し、接続済みなら何もしない", () => {
    const { s } = make();
    last().open();
    s.reconnectNow();
    expect(FakeWebSocket.instances).toHaveLength(1);
    last().drop();
    s.reconnectNow();
    expect(FakeWebSocket.instances).toHaveLength(2);
    last().open();
    vi.advanceTimersByTime(9000);
    expect(FakeWebSocket.instances).toHaveLength(2); // 古いタイマーは取り消される
  });

  test("メッセージ受信と送信、close 後は再接続しない", () => {
    const { s, messages } = make();
    last().open();
    last().receive({ type: "need_join" });
    expect(messages).toEqual([{ type: "need_join" }]);
    s.send({ type: "join", nickname: "a" });
    expect(JSON.parse(last().sent[0]!)).toEqual({ type: "join", nickname: "a" });
    s.close();
    vi.advanceTimersByTime(10000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe("heartbeat", () => {
  test("開いている間 10 秒ごとに ping を送る", () => {
    make();
    last().open();
    vi.advanceTimersByTime(9999);
    expect(last().sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(last().sent).toEqual(["ping"]);
    last().receiveRaw("pong");
    vi.advanceTimersByTime(10000);
    expect(last().sent).toEqual(["ping", "ping"]);
  });

  test("25 秒何も受信しなければ切断して再接続する", () => {
    const { statuses } = make();
    const first = last();
    first.open();
    vi.advanceTimersByTime(24999);
    expect(statuses).toEqual([true]);
    vi.advanceTimersByTime(1);
    expect(statuses).toEqual([true, false]);
    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  test("pong も受信時刻を更新するので生きている間は切れない", () => {
    const { statuses } = make();
    last().open();
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(10000);
      last().receiveRaw("pong");
    }
    expect(statuses).toEqual([true]);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  test("5 秒以内に open しなければ閉じて再接続する", () => {
    make();
    vi.advanceTimersByTime(4999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances[0]!.readyState).toBe(3);
    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  test("pong はアプリに渡さない", () => {
    const { messages } = make();
    last().open();
    last().receiveRaw("pong");
    expect(messages).toEqual([]);
  });

  test("reconnectNow は 10 秒以上無通信の open ソケットを作り直す", () => {
    const { s } = make();
    last().open();
    vi.advanceTimersByTime(9000);
    s.reconnectNow();
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(2000);
    s.reconnectNow();
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  test("reconnectNow は接続中のまま固まったソケットも作り直す", () => {
    const { s } = make();
    s.reconnectNow();
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  test("forceReconnect は開いていても即座に再接続する", () => {
    const { s } = make();
    last().open();
    s.forceReconnect();
    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});

describe("guest token handling", () => {
  test("need_join を受け取ったら保存済み playerToken を消す", () => {
    const store = memoryStore();
    store.set(playerTokenKey("s1"), "stale");
    handleGuestMessage("s1", { type: "need_join" }, store);
    expect(store.map.has(playerTokenKey("s1"))).toBe(false);
    expect(playerTokenKey("s1")).toBe("makunouchi:s1:playerToken");
  });

  test("joined を受け取ったら playerToken を保存し、次回の接続 URL に付ける", () => {
    const store = memoryStore();
    const loc = { protocol: "https:", host: "ex.com" };
    expect(buildGuestUrl(loc, "s1", store)).toBe("wss://ex.com/ws/s1/guest");
    handleGuestMessage("s1", { type: "joined", playerToken: "tok/1" }, store);
    expect(buildGuestUrl(loc, "s1", store)).toBe("wss://ex.com/ws/s1/guest?playerToken=tok%2F1");
    expect(buildGuestUrl({ protocol: "http:", host: "l:1" }, "s1", store)).toMatch(/^ws:\/\/l:1\//);
  });

  test("ストレージが例外を投げても落ちない", () => {
    const bad: TokenStore = {
      get: () => {
        throw new Error("x");
      },
      set: () => {
        throw new Error("x");
      },
      remove: () => {
        throw new Error("x");
      },
    };
    expect(() => handleGuestMessage("s", { type: "joined", playerToken: "t" }, bad)).not.toThrow();
    expect(() => handleGuestMessage("s", { type: "need_join" }, bad)).not.toThrow();
    expect(buildGuestUrl({ protocol: "http:", host: "h" }, "s", bad)).toBe("ws://h/ws/s/guest");
  });
});

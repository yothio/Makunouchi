// Pure quiz-driving logic shared by scripts/loadtest.ts (Node + ws) and
// test/worker/load.test.ts (in-process). No Node-only or Workers-only deps.
import type { ClientMessage, GuestView, HostView, ServerMessage } from "../shared/types";

export type Sock = {
  send(data: string): void;
  onMessage(cb: (data: string) => void): void;
  close(): void;
};

export type AdvanceStat = {
  from: string;
  to: string;
  /** ms until the slowest guest got the new guest_view (only guests that got it) */
  maxMs: number;
  missing: number;
};

export type LoadResult = {
  guests: number;
  advances: AdvanceStat[];
  worstMs: number;
  totalMissing: number;
  pass: boolean;
};

export type DriveOptions = {
  host: Sock;
  guests: Sock[];
  /** pass threshold per advance, default 2000 */
  limitMs?: number;
  /** how long to wait for stragglers before counting them missing, default 10000 */
  graceMs?: number;
  log?: (line: string) => void;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const now = () => performance.now();

/** Which guest_view proves that the guest saw the transition out of `from`. */
const expectedView = (from: string): ((v: GuestView) => boolean) => {
  if (from === "lobby") return (v) => v.kind === "question" && v.status === "open" && v.question.index === 0;
  const m = /^q:(\d+):(open|closed|revealed)$/.exec(from);
  if (!m) throw new Error(`unexpected phase ${from}`);
  const i = Number(m[1]);
  if (m[2] === "open") return (v) => v.kind === "question" && v.status === "closed" && v.question.index === i;
  if (m[2] === "closed") return (v) => v.kind === "reveal" && v.question.index === i;
  return (v) =>
    (v.kind === "question" && v.status === "open" && v.question.index === i + 1) || v.kind === "results_pending";
};

/**
 * Joins all guests, then drives the quiz from lobby through the last reveal
 * into the results list (the load test stops at `r:list`; free-order projection
 * steps are exercised separately). Each guest answers randomly in every open
 * phase. For every advance, measures how long until every guest has received
 * the matching new guest_view.
 */
export const driveQuiz = async (opts: DriveOptions): Promise<LoadResult> => {
  const { host, guests } = opts;
  const limitMs = opts.limitMs ?? 2000;
  const graceMs = opts.graceMs ?? 10000;
  const log = opts.log ?? (() => {});
  const n = guests.length;

  let hostView: HostView | null = null;
  host.onMessage((data) => {
    const msg = JSON.parse(data) as ServerMessage;
    if (msg.type === "host_view") hostView = msg.view;
  });

  let lobbyCount = 0;
  const joined = new Set<number>();
  let armed: { pred: (v: GuestView) => boolean; t0: number; arrivals: Map<number, number> } | null = null;

  guests.forEach((g, idx) => {
    let inLobby = false;
    g.onMessage((data) => {
      const msg = JSON.parse(data) as ServerMessage;
      if (msg.type === "need_join") {
        g.send(JSON.stringify({ type: "join", nickname: `guest-${idx}` } satisfies ClientMessage));
      } else if (msg.type === "joined") {
        joined.add(idx);
      } else if (msg.type === "join_error") {
        throw new Error(`guest ${idx} join_error: ${msg.reason}`);
      } else if (msg.type === "guest_view") {
        const v = msg.view;
        if (v.kind === "lobby" && !inLobby) {
          inLobby = true;
          lobbyCount++;
        }
        if (armed && !armed.arrivals.has(idx) && armed.pred(v)) armed.arrivals.set(idx, now() - armed.t0);
        if (v.kind === "question" && v.status === "open" && v.myChoice === null) {
          const questionIndex = v.question.index;
          setTimeout(
            () =>
              g.send(
                JSON.stringify({
                  type: "answer",
                  questionIndex,
                  choice: Math.floor(Math.random() * 4),
                } satisfies ClientMessage),
              ),
            Math.random() * 300,
          );
        }
      }
    });
  });

  const waitUntil = async (cond: () => boolean, timeoutMs: number, what: string) => {
    const deadline = now() + timeoutMs;
    while (!cond()) {
      if (now() > deadline) throw new Error(`timeout waiting for ${what}`);
      await sleep(5);
    }
  };

  await waitUntil(() => hostView !== null, 10000, "first host_view");
  await waitUntil(() => lobbyCount === n, 30000, `all ${n} guests in lobby (got ${lobbyCount})`);
  await waitUntil(() => (hostView as HostView | null)?.playerCount === n, 10000, "host playerCount");
  log(`${n} guests joined`);

  const advances: AdvanceStat[] = [];
  for (;;) {
    const from = (hostView as unknown as HostView).phaseKey;
    if (from.startsWith("r:")) break;
    if (from.endsWith(":open")) {
      // let every guest's answer land before closing
      await waitUntil(
        () => {
          const s = (hostView as unknown as HostView).screen;
          return s.kind === "question" && s.answeredCount >= n;
        },
        10000,
        `all answers for ${from}`,
      );
    }
    const t0 = now();
    armed = { pred: expectedView(from), t0, arrivals: new Map() };
    const mine = armed;
    host.send(JSON.stringify({ type: "advance", from } satisfies ClientMessage));
    const deadline = t0 + graceMs;
    while (mine.arrivals.size < n && now() < deadline) await sleep(2);
    const times = [...mine.arrivals.values()];
    const maxMs = times.length ? Math.max(...times) : 0;
    await waitUntil(() => (hostView as unknown as HostView).phaseKey !== from, 5000, "host phase change");
    const to = (hostView as unknown as HostView).phaseKey;
    const stat = { from, to, maxMs, missing: n - mine.arrivals.size };
    advances.push(stat);
    log(`advance ${from} -> ${to}: max ${maxMs.toFixed(0)} ms, missing ${stat.missing}`);
    armed = null;
  }

  const worstMs = Math.max(...advances.map((a) => a.maxMs));
  const totalMissing = advances.reduce((s, a) => s + a.missing, 0);
  const pass = advances.every((a) => a.maxMs <= limitMs && a.missing === 0);
  return { guests: n, advances, worstMs, totalMissing, pass };
};

// Pure quiz-driving logic shared by scripts/loadtest.ts (Node + ws) and
// test/worker/load.test.ts (in-process). No Node-only or Workers-only deps.
import type {
  ClientMessage,
  GuestView,
  HostView,
  ResultsAction,
  ScreenView,
  ServerMessage,
} from "../shared/types";

export type Sock = {
  send(data: string): void;
  onMessage(cb: (data: string) => void): void;
  close(): void;
};

export type AdvanceStat = {
  from: string;
  to: string;
  maxMs: number;
  missing: number;
};

export type PodiumStat = {
  from: string;
  to: string;
  action: ResultsAction["kind"];
  hostMs: number;
  screenMs: number;
  guestExtra: number;
};

export type LoadResult = {
  guests: number;
  advances: AdvanceStat[];
  podium: PodiumStat[];
  worstMs: number;
  totalMissing: number;
  pass: boolean;
};

export type DriveOptions = {
  host: Sock;
  screen: Sock;
  guests: Sock[];
  podiumSlots?: number;
  limitMs?: number;
  graceMs?: number;
  log?: (line: string) => void;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const now = () => performance.now();

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

const expectedHostAfter = (from: string, action: ResultsAction): ((v: HostView) => boolean) => {
  switch (action.kind) {
    case "select":
      return (v) => v.phaseKey === `r:${action.playerId}:hidden` && v.screen.kind === "ranking_detail";
    case "show_rank": {
      const m = /^r:([^:]+):/.exec(from);
      if (!m) throw new Error(`unexpected podium from ${from}`);
      const id = m[1];
      return (v) =>
        (v.phaseKey === `r:${id}:rank` || v.phaseKey === `r:${id}:both`) &&
        v.screen.kind === "ranking_detail" &&
        v.screen.rankShown;
    }
    case "show_name": {
      const m = /^r:([^:]+):/.exec(from);
      if (!m) throw new Error(`unexpected podium from ${from}`);
      const id = m[1];
      return (v) =>
        (v.phaseKey === `r:${id}:name` || v.phaseKey === `r:${id}:both`) &&
        v.screen.kind === "ranking_detail" &&
        v.screen.nameShown;
    }
    case "back":
      return (v) => v.phaseKey === "r:list" && v.screen.kind === "ranking";
  }
};

const expectedScreenAfter = (from: string, action: ResultsAction): ((v: ScreenView) => boolean) => {
  switch (action.kind) {
    case "select":
      return (v) => v.kind === "results_wait";
    case "show_rank":
      return (v) => v.kind === "rank_reveal" && v.rank !== null;
    case "show_name":
      return (v) => v.kind === "rank_reveal" && v.nickname !== null;
    case "back":
      return (v) => v.kind === "results_wait";
  }
};

export const driveQuiz = async (opts: DriveOptions): Promise<LoadResult> => {
  const { host, screen, guests } = opts;
  const limitMs = opts.limitMs ?? 2000;
  const graceMs = opts.graceMs ?? 10000;
  const podiumSlots = opts.podiumSlots ?? 3;
  const log = opts.log ?? (() => {});
  const n = guests.length;

  let hostView: HostView | null = null;
  let hostArmed: { pred: (v: HostView) => boolean; t0: number; arrived: number | null } | null = null;
  host.onMessage((data) => {
    const msg = JSON.parse(data) as ServerMessage;
    if (msg.type === "host_view") {
      hostView = msg.view;
      if (hostArmed && hostArmed.arrived === null && hostArmed.pred(msg.view)) {
        hostArmed.arrived = now() - hostArmed.t0;
      }
    }
  });

  let screenView: ScreenView | null = null;
  let screenArmed: { pred: (v: ScreenView) => boolean; t0: number; arrived: number | null } | null = null;
  screen.onMessage((data) => {
    const msg = JSON.parse(data) as ServerMessage;
    if (msg.type === "screen_view") {
      screenView = msg.view;
      if (screenArmed && screenArmed.arrived === null && screenArmed.pred(msg.view)) {
        screenArmed.arrived = now() - screenArmed.t0;
      }
    }
  });

  let lobbyCount = 0;
  const joined = new Set<number>();
  const guestMsgCounts = Array.from({ length: n }, () => 0);
  let armed: { pred: (v: GuestView) => boolean; t0: number; arrivals: Map<number, number> } | null = null;

  guests.forEach((g, idx) => {
    let inLobby = false;
    g.onMessage((data) => {
      guestMsgCounts[idx]++;
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

  await waitUntil(() => screenView !== null, 5000, "screen_view before podium");
  const rankingHost = hostView as unknown as HostView;
  const rankingScreen = rankingHost.screen;
  if (rankingScreen.kind !== "ranking") throw new Error(`expected ranking at podium start, got ${rankingScreen.kind}`);
  const top = rankingScreen.entries.slice(0, podiumSlots);
  const picks = Array.from({ length: top.length }, (_, i) => top[top.length - 1 - i]);

  const podium: PodiumStat[] = [];
  const runPodium = async (action: ResultsAction) => {
    const from = (hostView as unknown as HostView).phaseKey;
    const guestBaseline = guestMsgCounts.slice();
    const t0 = now();
    hostArmed = { pred: expectedHostAfter(from, action), t0, arrived: null };
    screenArmed = { pred: expectedScreenAfter(from, action), t0, arrived: null };
    const hostMine = hostArmed;
    const screenMine = screenArmed;
    host.send(JSON.stringify({ type: "results_action", from, action } satisfies ClientMessage));
    const deadline = t0 + graceMs;
    while ((hostMine.arrived === null || screenMine.arrived === null) && now() < deadline) await sleep(2);
    await waitUntil(() => hostMine.arrived !== null, 1000, `host after ${action.kind} from ${from}`);
    await waitUntil(() => screenMine.arrived !== null, 1000, `screen after ${action.kind} from ${from}`);
    const to = (hostView as unknown as HostView).phaseKey;
    const guestExtra = guestMsgCounts.reduce((s, c, i) => s + (c - guestBaseline[i]), 0);
    const stat: PodiumStat = {
      from,
      to,
      action: action.kind,
      hostMs: hostMine.arrived ?? 0,
      screenMs: screenMine.arrived ?? 0,
      guestExtra,
    };
    podium.push(stat);
    log(
      `podium ${action.kind} ${from} -> ${to}: host ${stat.hostMs.toFixed(0)} ms, screen ${stat.screenMs.toFixed(0)} ms, guestExtra ${guestExtra}`,
    );
    hostArmed = null;
    screenArmed = null;
  };

  for (const entry of picks) {
    await runPodium({ kind: "select", playerId: entry.playerId });
    await runPodium({ kind: "show_rank" });
    await runPodium({ kind: "show_name" });
    await runPodium({ kind: "back" });
  }

  const podiumWorst = podium.length ? Math.max(...podium.map((p) => Math.max(p.hostMs, p.screenMs))) : 0;
  const worstMs = Math.max(advances.length ? Math.max(...advances.map((a) => a.maxMs)) : 0, podiumWorst);
  const totalMissing = advances.reduce((s, a) => s + a.missing, 0);
  const advancesPass = advances.every((a) => a.maxMs <= limitMs && a.missing === 0);
  const podiumPass = podium.every((p) => p.hostMs <= limitMs && p.screenMs <= limitMs && p.guestExtra === 0);
  const pass = advancesPass && podiumPass && podium.length === podiumSlots * 4;
  return { guests: n, advances, podium, worstMs, totalMissing, pass };
};

import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { HostView, PublicQuestion } from "../../shared/types";
import { useLiveSocket } from "../use-live-socket";
import { AdvanceGate, buildHostUrl, hostActionLabel, listHeader } from "./host-action";

const LABELS = ["A", "B", "C", "D"] as const;

export function HostApp({ sessionId, token }: { sessionId: string; token: string }) {
  const [view, setView] = useState<HostView | null>(null);
  // Cooldown after a phase change + lock after a click; all timing lives in the gate.
  const [gate] = useState(() => new AdvanceGate());
  const { cooling, locked } = useSyncExternalStore(gate.subscribe, gate.getSnapshot);

  const { send, connected, forceReconnect } = useLiveSocket(
    () => buildHostUrl(window.location, sessionId, token),
    {
      onMessage: (msg) => {
        if (msg.type !== "host_view") return;
        gate.phaseChanged(msg.view.phaseKey);
        setView(msg.view);
      },
    },
  );

  // If the lock times out with no phase change the connection may be half-open: force a reconnect
  // (the lost advance can then be resent).
  useEffect(() => {
    gate.setLockExpiredHandler(forceReconnect);
    return () => gate.setLockExpiredHandler(null);
  }, [gate, forceReconnect]);
  useEffect(() => {
    gate.setConnected(connected);
  }, [gate, connected]);
  useEffect(() => () => gate.dispose(), [gate]);

  const label = view ? hostActionLabel(view) : null;
  const canAdvance = connected && view !== null && label !== null && !locked && !cooling;

  const advance = useCallback(() => {
    if (!view || label === null || !gate.tryAdvance()) return;
    send({ type: "advance", from: view.phaseKey });
  }, [view, label, gate, send]);

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.key !== " " && e.key !== "ArrowRight") return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "BUTTON" || t.isContentEditable)) return;
    e.preventDefault();
    advance();
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="host">
      {!connected && <div className="host-banner">再接続中…</div>}
      <main className="host-main">{view ? <Screen view={view} sessionId={sessionId} /> : <p className="host-wait">接続中…</p>}</main>
      {label && (
        <button type="button" className="host-advance" disabled={!canAdvance} onClick={advance}>
          {label}
        </button>
      )}
    </div>
  );
}

function Screen({ view, sessionId }: { view: HostView; sessionId: string }) {
  const s = view.screen;
  switch (s.kind) {
    case "lobby": {
      const url = `${window.location.origin}/s/${sessionId}`;
      return (
        <div className="host-lobby">
          <h1 className="host-title">{view.title}</h1>
          <QRCodeSVG value={url} size={360} marginSize={2} />
          <p className="host-url">{url}</p>
          <p className="host-count">参加人数 {view.playerCount} 人</p>
        </div>
      );
    }
    case "question":
      return (
        <div>
          <QuestionBlock q={s.question} />
          <ul className="host-choices">
            {s.question.choices.map((c, i) => (
              <li key={i} className="host-choice">
                <span className="host-label">{LABELS[i]}</span>
                {c}
              </li>
            ))}
          </ul>
          <p className="host-count">
            回答済み {s.answeredCount} / {view.playerCount} 人{s.status === "closed" ? "（締め切りました）" : ""}
          </p>
        </div>
      );
    case "reveal": {
      const max = Math.max(1, ...s.counts);
      return (
        <div>
          <QuestionBlock q={s.question} />
          <ul className="host-choices">
            {s.question.choices.map((c, i) => (
              <li key={i} className={`host-choice host-bar-row${i === s.correctIndex ? " correct" : ""}`}>
                <span className="host-label">{LABELS[i]}</span>
                <span className="host-choice-text">{c}</span>
                <span className="host-bar-track">
                  <span className="host-bar" style={{ width: `${(s.counts[i]! / max) * 100}%` }} />
                </span>
                <span className="host-bar-count">{s.counts[i]}</span>
              </li>
            ))}
          </ul>
          <p className="host-answer">正解は {LABELS[s.correctIndex]}：{s.question.choices[s.correctIndex]}</p>
        </div>
      );
    }
    case "list":
      return (
        <div>
          <h1 className="host-title">{listHeader(s.entries)}</h1>
          <FittedList entries={s.entries} />
        </div>
      );
    case "podium":
      return (
        <div className="host-podium">
          <h1 className="host-title">{s.rank} 位</h1>
          {s.revealed ? (
            <ul className="host-list">
              {s.players.map((p, i) => (
                <li key={i}>
                  <span className="host-name">{p.nickname}</span>
                  <span className="host-score">{p.score} 点</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="host-hidden">？？？</p>
          )}
        </div>
      );
  }
}

const FIT_MAX_PX = 40;
const FIT_MIN_PX = 12;
const FIT_MAX_COLS = 4;

/**
 * Ranking list that never silently clips: measure, trying the largest font first and the fewest
 * columns for it, and only if nothing fits at the floor font size fall back to a visible scroll.
 */
function FittedList({ entries }: { entries: Extract<HostView["screen"], { kind: "list" }>["entries"] }) {
  const ref = useRef<HTMLOListElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fits = () => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth;
    const fit = () => {
      el.style.overflowY = "hidden";
      for (let px = FIT_MAX_PX; px >= FIT_MIN_PX; px--) {
        el.style.fontSize = `${px}px`;
        for (let cols = 1; cols <= FIT_MAX_COLS; cols++) {
          el.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
          if (fits()) return;
        }
      }
      el.style.overflowY = "auto"; // cannot fit even at the floor: make the overflow visible and scrollable
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
    // `entries` is not read in the effect but drives the DOM being measured: re-fit whenever it changes.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [entries]);

  return (
    <ol ref={ref} className="host-list host-list-grid">
      {entries.map((e) => (
        <li key={`${e.rank}:${e.nickname}`}>
          <span className="host-rank">{e.rank} 位</span>
          <span className="host-name">{e.nickname}</span>
          <span className="host-score">{e.score} 点</span>
        </li>
      ))}
    </ol>
  );
}

function QuestionBlock({ q }: { q: PublicQuestion }) {
  return (
    <>
      <p className="host-progress">第 {q.index + 1} 問 / 全 {q.total} 問</p>
      <h1 className="host-q-title">{q.title}</h1>
      {q.imageUrl && <img className="host-q-image" src={q.imageUrl} alt="" />}
    </>
  );
}

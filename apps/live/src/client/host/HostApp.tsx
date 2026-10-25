import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { HostView, PublicQuestion } from "../../shared/types";
import { useLiveSocket } from "../use-live-socket";
import { ADVANCE_LOCK_MS, buildHostUrl, hostActionLabel, isAdvanceLocked, listHeader } from "./host-action";

const LABELS = ["A", "B", "C", "D"] as const;

export function HostApp({ sessionId, token }: { sessionId: string; token: string }) {
  const [view, setView] = useState<HostView | null>(null);
  // Last advance we sent; locks the button until phase change, disconnect or timeout.
  const [sent, setSent] = useState<{ from: string; at: number } | null>(null);

  const { send, connected } = useLiveSocket(
    () => buildHostUrl(window.location, sessionId, token),
    {
      onMessage: (msg) => {
        if (msg.type === "host_view") setView(msg.view);
      },
    },
  );

  const label = view ? hostActionLabel(view) : null;
  const phaseKey = view?.phaseKey ?? null;
  const locked = phaseKey !== null && isAdvanceLocked(sent, phaseKey, connected, Date.now());
  const canAdvance = connected && view !== null && label !== null && !locked;

  // Clear the lock on disconnect / phase change, or after the timeout (re-render to unlock).
  useEffect(() => {
    if (!sent) return;
    if (!connected || sent.from !== phaseKey) {
      setSent(null);
      return;
    }
    const t = setTimeout(() => setSent(null), Math.max(0, ADVANCE_LOCK_MS - (Date.now() - sent.at)));
    return () => clearTimeout(t);
  }, [sent, connected, phaseKey]);

  const advance = useCallback(() => {
    if (!view || !canAdvance) return;
    setSent({ from: view.phaseKey, at: Date.now() });
    send({ type: "advance", from: view.phaseKey });
  }, [view, canAdvance, send]);

  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key !== " " && e.key !== "ArrowRight") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "BUTTON" || t.isContentEditable)) return;
      e.preventDefault();
      advanceRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
          <ol className={`host-list host-list-grid ${listSize(s.entries.length)}`}>
            {s.entries.map((e) => (
              <li key={`${e.rank}:${e.nickname}`}>
                <span className="host-rank">{e.rank} 位</span>
                <span className="host-name">{e.nickname}</span>
                <span className="host-score">{e.score} 点</span>
              </li>
            ))}
          </ol>
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

function listSize(n: number): string {
  return n <= 10 ? "size-l" : n <= 30 ? "size-m" : "size-s";
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

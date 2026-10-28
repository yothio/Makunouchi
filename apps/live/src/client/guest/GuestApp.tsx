import { useMemo, useState, type FormEvent } from "react";
import type { Choice, GuestView, ServerMessage } from "../../shared/types";
import { useLiveSocket } from "../use-live-socket";
import { buildGuestUrl, handleGuestMessage, localTokenStore } from "./guest-socket";

type JoinError = Extract<ServerMessage, { type: "join_error" }>["reason"];

const JOIN_ERROR_TEXT: Record<JoinError, string> = {
  nickname_taken: "その名前は使われています",
  nickname_invalid: "1〜20 文字で入力してください",
  closed: "受付は終了しました",
};

const LABELS = ["A", "B", "C", "D"] as const;

export const GuestApp = ({ sessionId }: { sessionId: string }) => {
  const [view, setView] = useState<GuestView | null>(null);
  const [needJoin, setNeedJoin] = useState(false);
  const [joinError, setJoinError] = useState<JoinError | null>(null);
  // Optimistic highlight only; cleared whenever a server guest_view arrives.
  const [pending, setPending] = useState<{ index: number; choice: Choice } | null>(null);

  const { send, connected } = useLiveSocket(
    () => buildGuestUrl(window.location, sessionId, localTokenStore),
    {
      onMessage: (msg) => {
        handleGuestMessage(sessionId, msg, localTokenStore);
        if (msg.type === "guest_view") {
          setView(msg.view);
          setNeedJoin(false);
          setJoinError(null);
          setPending(null);
        } else if (msg.type === "need_join") {
          setView(null);
          setNeedJoin(true);
        } else if (msg.type === "join_error") {
          setJoinError(msg.reason);
        }
      },
    },
  );

  const body = useMemo(() => {
    if (view) {
      return (
        <ViewBody
          view={view}
          pending={pending}
          disabled={!connected}
          onAnswer={(questionIndex, choice) => {
            setPending({ index: questionIndex, choice });
            send({ type: "answer", questionIndex, choice });
          }}
        />
      );
    }
    if (needJoin) {
      return (
        <JoinForm error={joinError} disabled={!connected} onSubmit={(nickname) => send({ type: "join", nickname })} />
      );
    }
    return <p className="note">接続しています…</p>;
  }, [view, needJoin, joinError, pending, connected, send]);

  return (
    <div className="guest">
      {!connected && (
        <div className="banner" role="status">
          再接続中…
        </div>
      )}
      <main className="guest-main">{body}</main>
    </div>
  );
};

const JoinForm = ({
  error,
  disabled,
  onSubmit,
}: {
  error: JoinError | null;
  disabled: boolean;
  onSubmit(nickname: string): void;
}) => {
  const [name, setName] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(name);
  };
  return (
    <form className="join" onSubmit={submit}>
      <h1>ニックネームを入力</h1>
      <input
        className="text-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="ニックネーム"
        autoComplete="off"
        enterKeyHint="go"
        aria-label="ニックネーム"
      />
      {error && (
        <p className="error" role="alert">
          {JOIN_ERROR_TEXT[error]}
        </p>
      )}
      <button className="primary" type="submit" disabled={disabled}>
        参加する
      </button>
    </form>
  );
};

const ViewBody = ({
  view,
  pending,
  disabled,
  onAnswer,
}: {
  view: GuestView;
  pending: { index: number; choice: Choice } | null;
  disabled: boolean;
  onAnswer(questionIndex: number, choice: Choice): void;
}) => {
  switch (view.kind) {
    case "lobby":
      return (
        <section className="center">
          <p className="nick">{view.nickname}</p>
          <h1>まもなく始まります</h1>
          <p className="note">{view.title}</p>
        </section>
      );
    case "question": {
      const q = view.question;
      const open = view.status === "open";
      const mine =
        view.myChoice ?? (pending && pending.index === q.index ? pending.choice : null);
      return (
        <section>
          <p className="progress">
            第 {q.index + 1} 問 / {q.total}
          </p>
          <h1 className="q-title">{q.title}</h1>
          {q.imageUrl && <img className="q-image" src={q.imageUrl} alt="" />}
          {open ? (
            <div className="choices">
              {q.choices.map((text, i) => (
                <button
                  key={i}
                  type="button"
                  className={`choice${mine === i ? " selected" : ""}`}
                  aria-pressed={mine === i}
                  disabled={disabled}
                  onClick={() => onAnswer(q.index, i as Choice)}
                >
                  <span className="label">{LABELS[i]}</span>
                  <span>{text}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="closed">
              <p className="closed-title">締め切りました</p>
              {mine !== null ? (
                <p>
                  あなたの回答: {LABELS[mine]}　{q.choices[mine]}
                </p>
              ) : (
                <p>回答なし</p>
              )}
            </div>
          )}
        </section>
      );
    }
    case "reveal":
      return (
        <section className="center">
          <div className={`mark ${view.correct ? "ok" : "ng"}`} aria-label={view.correct ? "正解" : "不正解"}>
            {view.correct ? "⭕" : "❌"}
          </div>
          <p className="score">{view.score} 点</p>
        </section>
      );
    case "results_pending":
      return (
        <section className="center">
          <p className="nick">{view.nickname}</p>
          <h1>結果発表中…</h1>
        </section>
      );
    case "final":
      return (
        <section className="center">
          <p className="nick">{view.nickname}</p>
          <h1>
            あなたは {view.rank} 位（{view.score} 点）
          </h1>
        </section>
      );
  }
};

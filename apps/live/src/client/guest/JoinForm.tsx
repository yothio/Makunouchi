import { useState, type FormEvent } from "react";
import type { JoinError } from "./types";

const JOIN_ERROR_TEXT: Record<JoinError, string> = {
  nickname_taken: "その名前は使われています",
  nickname_invalid: "1〜20 文字で入力してください",
  closed: "受付は終了しました",
  full: "参加人数がいっぱいです",
};

export const JoinForm = ({
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

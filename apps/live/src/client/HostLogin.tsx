import type { HostLoginErrorKind } from "./host-login-error";
import { useHostLogin } from "./useHostLogin";

const errorMessage = (kind: HostLoginErrorKind): string => {
  switch (kind) {
    case "invalid_credentials":
      return "ID またはパスワードが違います";
    case "unsupported":
      return "この開催回は ID/パスワードに未対応です（トークン付き URL を使ってください）";
    case "locked":
      return "失敗が続いたため、しばらく待ってから再度お試しください";
    case "network":
      return "通信に失敗しました。接続を確認してもう一度お試しください";
  }
};

export const HostLogin = ({
  sessionId,
  onSuccess,
}: {
  sessionId: string;
  onSuccess: (token: string) => void;
}) => {
  const { loginId, setLoginId, password, setPassword, submitting, error, submit } = useHostLogin(
    sessionId,
    onSuccess,
  );

  return (
    <div className="guest">
      <main className="guest-main">
        <form
          className="join"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <h1>幹事ログイン</h1>
          <p className="note">開催回の ID とパスワードを入力してください</p>
          <label className="note" htmlFor="host-login-id">
            ID
          </label>
          <input
            id="host-login-id"
            className="text-input"
            autoComplete="username"
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            disabled={submitting}
          />
          <label className="note" htmlFor="host-login-password">
            パスワード
          </label>
          <input
            id="host-login-password"
            className="text-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
          />
          {error && <p className="error">{errorMessage(error)}</p>}
          <button type="submit" className="primary" disabled={submitting || !loginId || !password}>
            {submitting ? "確認中…" : "ログイン"}
          </button>
        </form>
      </main>
    </div>
  );
};

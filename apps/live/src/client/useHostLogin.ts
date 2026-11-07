import { useState } from "react";
import { classifyHostLoginError, type HostLoginErrorKind } from "./host-login-error";
import { storeToken } from "./token-store";

export type HostLoginSuccess = { token: string };

const sessionStorageOrNull = (): Storage | null => {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
};

export const useHostLogin = (sessionId: string, onSuccess: (token: string) => void) => {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<HostLoginErrorKind | null>(null);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/host-login/${encodeURIComponent(sessionId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, password }),
      });
      if (!res.ok) {
        setError(classifyHostLoginError({ kind: "http", status: res.status }));
        return;
      }
      const body = (await res.json()) as { token?: unknown };
      if (typeof body.token !== "string" || !body.token) {
        setError("network");
        return;
      }
      storeToken("host", sessionId, body.token, sessionStorageOrNull());
      onSuccess(body.token);
    } catch {
      setError("network");
    } finally {
      setSubmitting(false);
    }
  };

  return { loginId, setLoginId, password, setPassword, submitting, error, submit };
};

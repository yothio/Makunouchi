import { useState } from "react";
import { HostLogin } from "../HostLogin";
import { clearStoredToken } from "../token-store";
import { applyHostGateEvent, initialHostGateState, screenForHostGate } from "./host-gate-state";
import { HostApp } from "./HostApp";

const sessionStorageOrNull = (): Storage | null => {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
};

export const HostGate = ({ sessionId, initialToken }: { sessionId: string; initialToken: string }) => {
  const [state, setState] = useState(() => initialHostGateState(initialToken));
  const screen = screenForHostGate(state);

  if (screen === "HostLogin") {
    return (
      <HostLogin
        sessionId={sessionId}
        onSuccess={(token) => setState((s) => applyHostGateEvent(s, { type: "login_success", token }))}
      />
    );
  }

  return (
    <HostApp
      sessionId={sessionId}
      token={state.token}
      onRelogin={() => {
        clearStoredToken("host", sessionId, sessionStorageOrNull());
        setState((s) => applyHostGateEvent(s, { type: "discard_token" }));
      }}
    />
  );
};

import { useCallback, useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";
import type { HostView, ResultsAction } from "../../shared/types";
import { buildSocketUrl } from "../socket-url";
import { useLiveSocket } from "../use-live-socket";
import { AdvanceGate, hostActionLabel, resultsActionMessage } from "./host-action";

export const useHostSession = (sessionId: string, token: string) => {
  const [view, setView] = useState<HostView | null>(null);
  // Cooldown after a phase change + lock after a click; all timing lives in the gate.
  const [gate] = useState(() => new AdvanceGate());
  const [resultsGate] = useState(() => new AdvanceGate({ cooldownMs: 0 }));
  const { cooling, locked } = useSyncExternalStore(gate.subscribe, gate.getSnapshot);
  const resultsGateState = useSyncExternalStore(resultsGate.subscribe, resultsGate.getSnapshot);

  const { send, connected, forceReconnect } = useLiveSocket(
    () => buildSocketUrl(window.location, "host", sessionId, token),
    {
      onMessage: (msg) => {
        if (msg.type !== "host_view") return;
        gate.phaseChanged(msg.view.phaseKey);
        resultsGate.phaseChanged(msg.view.phaseKey);
        setView(msg.view);
      },
    },
  );

  // If the lock times out with no phase change the connection may be half-open: force a reconnect
  // (the lost advance can then be resent).
  useEffect(() => {
    gate.setLockExpiredHandler(forceReconnect);
    resultsGate.setLockExpiredHandler(forceReconnect);
    return () => {
      gate.setLockExpiredHandler(null);
      resultsGate.setLockExpiredHandler(null);
    };
  }, [gate, resultsGate, forceReconnect]);
  useEffect(() => {
    gate.setConnected(connected);
    resultsGate.setConnected(connected);
  }, [gate, resultsGate, connected]);
  useEffect(() => {
    return () => {
      gate.dispose();
      resultsGate.dispose();
    };
  }, [gate, resultsGate]);

  const label = view ? hostActionLabel(view) : null;
  const canAdvance = connected && view !== null && label !== null && !locked && !cooling;

  const advance = useCallback(() => {
    if (!view || label === null || !gate.tryAdvance()) return;
    send({ type: "advance", from: view.phaseKey });
  }, [view, label, gate, send]);

  const sendResultsAction = useCallback(
    (action: ResultsAction) => {
      if (!view || !connected || !resultsGate.tryAdvance()) return;
      send(resultsActionMessage(view.phaseKey, action));
    },
    [view, connected, resultsGate, send],
  );

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

  return {
    view,
    connected,
    label,
    canAdvance,
    advance,
    sendResultsAction,
    resultsLocked: !connected || resultsGateState.locked,
  };
};

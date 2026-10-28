import { useCallback, useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";
import type { HostView } from "../../shared/types";
import { useLiveSocket } from "../use-live-socket";
import { AdvanceGate, buildHostUrl, hostActionLabel } from "./host-action";

export const useHostSession = (sessionId: string, token: string) => {
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

  return { view, connected, label, canAdvance, advance };
};

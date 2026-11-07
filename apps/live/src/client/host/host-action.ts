import type { HostView } from "../../shared/types";

/** Label of the single progress button, or null when no button should be shown. */
export const hostActionLabel = (view: HostView): string | null => {
  const s = view.screen;
  switch (s.kind) {
    case "lobby":
      return "スタート";
    case "question":
      return s.status === "open" ? "回答を締め切る" : "正解を発表";
    case "reveal":
      return s.isLast ? "結果発表へ" : "次の問題へ";
    case "list":
      return s.nextRank === null ? null : `${s.nextRank} 位を発表`;
    case "podium":
      if (!s.revealed) return "めくる";
      return s.nextRank === null ? null : `${s.nextRank} 位へ`;
  }
};

export const ADVANCE_LOCK_MS = 3000;

/** After the phase changes, ignore advance input for a while so a double-click can't skip a screen. */
export const ADVANCE_COOLDOWN_MS = 1000;

export type AdvanceGateState = { readonly cooling: boolean; readonly locked: boolean };

/**
 * Event-driven gate for the host advance button. Both flags are explicit state cleared by timers,
 * never derived by comparing clocks, so a timer that fires slightly early cannot leave the gate stuck.
 *
 * - cooling: set when a new phase arrives, cleared after ADVANCE_COOLDOWN_MS.
 * - locked: set by an accepted advance; cleared on phase change, disconnect, or after ADVANCE_LOCK_MS
 *   (the last case also calls the lock-expired handler, since the connection may be half-open).
 *
 * Resending after unlock is safe: the server dedupes on `from`.
 * Compatible with useSyncExternalStore (subscribe / getSnapshot).
 */
export class AdvanceGate {
  private phaseKey: string | null = null;
  private connected = true;
  private cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  private lockTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private onLockExpired: (() => void) | null = null;
  private snapshot: AdvanceGateState = { cooling: false, locked: false };

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): AdvanceGateState => this.snapshot;

  setLockExpiredHandler(handler: (() => void) | null): void {
    this.onLockExpired = handler;
  }

  /** Call for every host_view; only a changed phaseKey has an effect. */
  phaseChanged(phaseKey: string): void {
    if (phaseKey === this.phaseKey) return;
    this.phaseKey = phaseKey;
    this.clearLockTimer();
    this.clearCooldownTimer();
    this.cooldownTimer = setTimeout(() => {
      this.cooldownTimer = null;
      this.publish({ cooling: false, locked: this.snapshot.locked });
    }, ADVANCE_COOLDOWN_MS);
    this.publish({ cooling: true, locked: false });
  }

  setConnected(connected: boolean): void {
    this.connected = connected;
    if (!connected && this.snapshot.locked) {
      this.clearLockTimer();
      this.publish({ cooling: this.snapshot.cooling, locked: false });
    }
  }

  /** Returns true (and locks) if an advance may be sent now. */
  tryAdvance(): boolean {
    if (!this.connected || this.snapshot.cooling || this.snapshot.locked) return false;
    this.lockTimer = setTimeout(() => {
      this.lockTimer = null;
      this.publish({ cooling: this.snapshot.cooling, locked: false });
      this.onLockExpired?.();
    }, ADVANCE_LOCK_MS);
    this.publish({ cooling: false, locked: true });
    return true;
  }

  /** Stops timers (unmount). */
  dispose(): void {
    this.clearLockTimer();
    this.clearCooldownTimer();
  }

  private clearLockTimer(): void {
    if (this.lockTimer !== null) clearTimeout(this.lockTimer);
    this.lockTimer = null;
  }

  private clearCooldownTimer(): void {
    if (this.cooldownTimer !== null) clearTimeout(this.cooldownTimer);
    this.cooldownTimer = null;
  }

  private publish(next: AdvanceGateState): void {
    if (next.cooling === this.snapshot.cooling && next.locked === this.snapshot.locked) return;
    this.snapshot = next;
    for (const l of this.listeners) l();
  }
}

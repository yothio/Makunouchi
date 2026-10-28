import type { HostView } from "../../shared/types";

export type HostScreenOf<K extends HostView["screen"]["kind"]> = Extract<HostView["screen"], { kind: K }>;

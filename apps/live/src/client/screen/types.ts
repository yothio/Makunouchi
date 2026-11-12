import type { ScreenView } from "@shared/types";

export type ScreenOf<K extends ScreenView["kind"]> = Extract<ScreenView, { kind: K }>;

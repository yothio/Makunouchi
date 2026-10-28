import type { Choice, GuestView, ServerMessage } from "../../shared/types";

export type JoinError = Extract<ServerMessage, { type: "join_error" }>["reason"];

/** Optimistic answer highlight; cleared whenever a server guest_view arrives. */
export type PendingAnswer = { index: number; choice: Choice };

export type GuestViewOf<K extends GuestView["kind"]> = Extract<GuestView, { kind: K }>;

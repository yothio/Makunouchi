import type { Choice, GuestView, ServerMessage } from "../../shared/types";

export type JoinError = Extract<ServerMessage, { type: "join_error" }>["reason"];

/** UI だけの仮選択。guest_view 到着で必ず消す。 */
export type PendingAnswer = { index: number; choice: Choice };

export type GuestViewOf<K extends GuestView["kind"]> = Extract<GuestView, { kind: K }>;

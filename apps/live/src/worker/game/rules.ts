import type { PodiumRank } from "../../shared/types";

/** Podium slots in announce order: 3rd first, 1st last. */
export const PODIUM_RANKS: readonly PodiumRank[] = [3, 2, 1];

/**
 * The projector list shows at most this many rows per page. Sized so that 40 rows stay at 20px or larger on
 * 1280x720 (about 22px by hand calculation); lower it if a real screen cannot keep 20px.
 */
export const LIST_PAGE_SIZE = 40;

/** First rank shown in the list stage; ranks 1-3 are the podium. */
export const LIST_FIRST_RANK = 4;

/** Nickname length limits, counted in code points after NFKC normalisation and trim. */
export const NICKNAME_MIN_LENGTH = 1;
export const NICKNAME_MAX_LENGTH = 20;

/** Every question has this many choices, indexed 0..CHOICE_COUNT-1. */
export const CHOICE_COUNT = 4;

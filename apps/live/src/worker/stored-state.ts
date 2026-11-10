import { z } from "zod";
import type { GameState } from "./game/types";

/**
 * Shape version of the stored `"state"`. Bump it when `GameState` changes shape, and teach
 * `loadStoredState` to read the previous shape: sessions are created before the event day,
 * so a deploy in between must still read what was stored.
 */
export const STATE_SCHEMA_VERSION = 1;
export const STATE_VERSION_KEY = "stateVersion";

const choiceSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

// Loose objects keep keys this code does not know, so a rolled-back deploy does not drop
// fields a newer one wrote. Only fields with an obvious empty value get defaults; anything
// else missing is reported, not guessed.
const questionSchema = z.looseObject({
  title: z.string(),
  imageUrl: z.string().nullable().default(null),
  choices: z.tuple([z.string(), z.string(), z.string(), z.string()]),
  correctIndex: choiceSchema,
});

const phaseSchema = z.discriminatedUnion("type", [
  z.looseObject({ type: z.literal("lobby") }),
  z.looseObject({
    type: z.literal("question"),
    index: z.number().int().nonnegative(),
    status: z.enum(["open", "closed", "revealed"]),
  }),
  z.looseObject({
    type: z.literal("results"),
    stage: z.discriminatedUnion("kind", [
      z.looseObject({ kind: z.literal("list") }),
      z.looseObject({
        kind: z.literal("player"),
        playerId: z.string(),
        rankShown: z.boolean(),
        nameShown: z.boolean(),
      }),
    ]),
  }),
]);

const playerSchema = z.looseObject({
  id: z.string(),
  token: z.string(),
  nickname: z.string(),
  // JSON turns the numeric question indexes into string keys.
  answers: z.record(z.string().regex(/^\d+$/), choiceSchema).default({}),
});

const storedStateSchema = z.looseObject({
  quiz: z.looseObject({ title: z.string(), questions: z.array(questionSchema) }),
  phase: phaseSchema,
  players: z.array(playerSchema).default([]),
}) satisfies z.ZodType<GameState>;

export type LoadedState = { state: GameState | null; issues: string[] };

// Path and zod code only: messages could echo stored values such as nicknames or tokens.
const describeIssue = (issue: z.core.$ZodIssue): string => `${issue.path.join(".") || "(root)"}: ${issue.code}`;

/**
 * Reads the stored state without ever refusing it. A shape this code does not expect is
 * returned as stored together with `issues`: stopping a live session is worse than running
 * it on an odd state, and the stored value must survive for a fix to read it later.
 */
export const loadStoredState = (raw: unknown, storedVersion: unknown): LoadedState => {
  if (raw === undefined || raw === null) return { state: null, issues: [] };
  const issues: string[] = [];
  // Sessions created before versioning have no version key and are already in this shape.
  if (storedVersion !== undefined && storedVersion !== STATE_SCHEMA_VERSION) {
    issues.push(`${STATE_VERSION_KEY}: expected ${STATE_SCHEMA_VERSION}, got ${JSON.stringify(storedVersion)}`);
  }
  const parsed = storedStateSchema.safeParse(raw);
  if (!parsed.success) {
    return { state: raw as GameState, issues: [...issues, ...parsed.error.issues.map(describeIssue)] };
  }
  return { state: parsed.data, issues };
};

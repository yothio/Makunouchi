import { z } from "zod";
import type { GameState } from "./game/types";

/**
 * 保存している `"state"` の形の版。`GameState` の形を変えるときは版を上げ、前の版の形も
 * `loadStoredState` で読めるようにする。開催回は当日より前に作るので、作成から当日までの
 * デプロイをまたいでも保存済みの状態を読めなければならない。
 */
export const STATE_SCHEMA_VERSION = 1;
export const STATE_VERSION_KEY = "stateVersion";

const choiceSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

// looseObject にするのは、知らないキーを残して、ロールバックした古いコードが新しいデプロイの
// 書いた項目を消さないようにするため。既定値で補うのは空の値が明らかな項目だけで、
// それ以外の欠けは推測で補わずに報告する。
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
  // 問題の番号は JSON を通すと文字列のキーになる。
  answers: z.record(z.string().regex(/^\d+$/), choiceSchema).default({}),
});

const storedStateSchema = z.looseObject({
  quiz: z.looseObject({ title: z.string(), questions: z.array(questionSchema) }),
  phase: phaseSchema,
  players: z.array(playerSchema).default([]),
}) satisfies z.ZodType<GameState>;

export type LoadedState = { state: GameState | null; issues: string[] };

// パスと zod の code だけにする。message には保存値（ニックネームやトークン）が入りうる。
const describeIssue = (issue: z.core.$ZodIssue): string => `${issue.path.join(".") || "(root)"}: ${issue.code}`;

/**
 * 保存済みの状態を、拒否せずに読む。想定外の形はそのまま `issues` とともに返す。
 * 進行中の開催回を止めるより、おかしな状態でも動かすほうがよく、後で直すときに
 * 読めるよう保存値も残す必要がある。
 */
export const loadStoredState = (raw: unknown, storedVersion: unknown): LoadedState => {
  if (raw === undefined || raw === null) return { state: null, issues: [] };
  const issues: string[] = [];
  // 版を持たせる前に作った開催回には版のキーがないが、形は今の版と同じ。
  if (storedVersion !== undefined && storedVersion !== STATE_SCHEMA_VERSION) {
    issues.push(`${STATE_VERSION_KEY}: expected ${STATE_SCHEMA_VERSION}, got ${JSON.stringify(storedVersion)}`);
  }
  const parsed = storedStateSchema.safeParse(raw);
  if (!parsed.success) {
    return { state: raw as GameState, issues: [...issues, ...parsed.error.issues.map(describeIssue)] };
  }
  return { state: parsed.data, issues };
};

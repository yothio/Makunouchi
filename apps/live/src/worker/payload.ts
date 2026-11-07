import { z } from "zod";

// Limits on the quiz payload accepted at session creation. They only matter to this schema, so they
// live here; the rules other game code depends on are in game/rules.ts.
const QUESTION_COUNT_MIN = 5;
const QUESTION_COUNT_MAX = 15;
const QUIZ_TITLE_MAX_LENGTH = 100;
const QUESTION_TITLE_MAX_LENGTH = 200;
const CHOICE_TEXT_MAX_LENGTH = 50;

const choiceText = z.string().min(1).max(CHOICE_TEXT_MAX_LENGTH);

const questionSchema = z.object({
  title: z.string().min(1).max(QUESTION_TITLE_MAX_LENGTH),
  imageUrl: z
    .url({ protocol: /^https$/ })
    .nullable(),
  // Four choices (CHOICE_COUNT); the tuple and literal union keep the inferred type equal to `Choice`.
  choices: z.tuple([choiceText, choiceText, choiceText, choiceText]),
  correctIndex: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});

// Unknown keys are dropped (zod's default), so a legacy payload that still carries `points` / `topN` is accepted
// and those fields are not stored.
export const quizPayloadSchema = z.object({
  title: z.string().min(1).max(QUIZ_TITLE_MAX_LENGTH),
  questions: z.array(questionSchema).min(QUESTION_COUNT_MIN).max(QUESTION_COUNT_MAX),
});

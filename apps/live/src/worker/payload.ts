import { z } from "zod";

const choiceText = z.string().min(1).max(50);

const questionSchema = z.object({
  title: z.string().min(1).max(200),
  imageUrl: z
    .url({ protocol: /^https$/ })
    .nullable(),
  choices: z.tuple([choiceText, choiceText, choiceText, choiceText]),
  correctIndex: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  points: z.number().int().min(1).max(1000),
});

export const quizPayloadSchema = z.object({
  title: z.string().min(1).max(100),
  topN: z.number().int().min(4).max(100),
  questions: z.array(questionSchema).min(5).max(15),
});

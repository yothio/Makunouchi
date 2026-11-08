import { z } from "zod";
import type { ClientMessage } from "../shared/types";

// Deliberately permissive: nickname length/normalisation and choice range are
// validated by the game layer, which owns the matching rejection reasons.
const resultsActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("select"), playerId: z.string() }),
  z.object({ kind: z.literal("show_rank") }),
  z.object({ kind: z.literal("show_name") }),
  z.object({ kind: z.literal("back") }),
]);

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("join"), nickname: z.string() }),
  z.object({ type: z.literal("answer"), questionIndex: z.number(), choice: z.number() }),
  z.object({ type: z.literal("advance"), from: z.string() }),
  z.object({ type: z.literal("results_action"), from: z.string(), action: resultsActionSchema }),
]) satisfies z.ZodType<ClientMessage>;

export const parseClientMessage = (raw: string): ClientMessage | null => {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = clientMessageSchema.safeParse(data);
  return result.success ? result.data : null;
};

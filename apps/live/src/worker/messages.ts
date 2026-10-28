import { z } from "zod";
import type { ClientMessage } from "../shared/types";

// Deliberately permissive: nickname length/normalisation and choice range are
// validated by the game layer, which owns the matching rejection reasons.
export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("join"), nickname: z.string() }),
  z.object({ type: z.literal("answer"), questionIndex: z.number(), choice: z.number() }),
  z.object({ type: z.literal("advance"), from: z.string() }),
]) satisfies z.ZodType<ClientMessage>;

/** Parse a raw WebSocket frame; anything malformed or unknown yields null. */
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

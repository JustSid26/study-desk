/**
 * The request body both judge routes take. Colocated rather than exported from
 * a route file, because a `route.ts` may only export route handlers and
 * segment config.
 */
import { z } from "zod";

export const JudgeBody = z.object({
  slug: z
    .string()
    .trim()
    .min(1, "Which problem?")
    .max(120)
    .regex(/^[a-z0-9-]+$/, "That isn't a LeetCode problem name."),
  questionId: z
    .string()
    .trim()
    .min(1, "That problem is missing its LeetCode id — reload the page.")
    .max(24)
    .regex(/^\d+$/, "That isn't a LeetCode question id."),
  lang: z
    .string()
    .trim()
    .min(1, "Pick a language first.")
    .max(40)
    .regex(/^[a-z0-9+#._-]+$/i, "That isn't a language LeetCode knows."),
  code: z
    .string()
    .min(1, "There's nothing in the editor to send.")
    .max(200_000, "That solution is too long to send."),
  input: z.string().max(50_000, "That testcase is too long to send.").optional(),
});

export type JudgeBodyInput = z.infer<typeof JudgeBody>;

/** Parse a request body without ever throwing at the caller. */
export async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

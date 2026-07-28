import type { ZodSchema } from "zod";
import { unprocessable } from "./errors.js";

/** Parse + validate a request payload, throwing a 422 with the first issue on failure. */
export function parse<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join(".");
    throw unprocessable(path ? `${path}: ${issue?.message}` : (issue?.message ?? "Invalid input"));
  }
  return result.data;
}

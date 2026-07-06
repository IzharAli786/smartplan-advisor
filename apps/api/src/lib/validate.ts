import type { ZodSchema } from "zod";
import { badRequest } from "./errors.js";

/** Parse + validate a request payload, throwing a 400 with the first issue on failure. */
export function parse<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join(".");
    throw badRequest(path ? `${path}: ${issue?.message}` : (issue?.message ?? "Invalid input"), "validation");
  }
  return result.data;
}

import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";

/** bcryptjs is pure-JS (no native build) — reliable across platforms incl. Windows. */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Opaque invite/reset token: return the raw token (emailed) + its sha256 hash (stored). */
export function generateToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("hex");
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

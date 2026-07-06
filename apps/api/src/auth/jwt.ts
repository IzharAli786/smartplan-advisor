import jwt from "jsonwebtoken";
import type { Role } from "@smart-crm/shared";
import { env } from "../env.js";

export interface SessionClaims {
  sub: string; // user id
  role: Role;
  sv: number; // session_version — mismatch invalidates the token
}

export function signSession(claims: SessionClaims): string {
  return jwt.sign(claims, env.authSecret, { expiresIn: `${env.sessionTtlHours}h` });
}

export function verifySession(token: string): SessionClaims | null {
  try {
    const decoded = jwt.verify(token, env.authSecret) as jwt.JwtPayload;
    if (typeof decoded.sub !== "string" || typeof decoded.role !== "string") return null;
    return { sub: decoded.sub, role: decoded.role as Role, sv: Number(decoded.sv ?? 0) };
  } catch {
    return null;
  }
}

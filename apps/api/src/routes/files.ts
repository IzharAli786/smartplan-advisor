import type { FastifyInstance } from "fastify";
import { storage } from "../lib/storage.js";
import { forbidden, notFound } from "../lib/errors.js";

/**
 * Signed file delivery (§11.5). The signature + expiry ARE the authorization — raw
 * storage keys are never usable without a valid signature. Bytes come from Postgres.
 */
export async function registerFileRoutes(app: FastifyInstance) {
  // Wildcard (not ":key") because storage keys contain "/" (e.g. avatars/<uuid>.png).
  // Behind IIS/ARR an encoded %2F is decoded to a real "/" before it reaches us, so a
  // single-segment :key param would 404 on the multi-segment path. The wildcard matches
  // the whole remainder; we decode each segment to recover the exact signed key.
  app.get("/files/*", async (req, reply) => {
    const raw = (req.params as Record<string, string>)["*"] ?? "";
    const key = raw
      .split("/")
      .map((seg) => {
        try {
          return decodeURIComponent(seg);
        } catch {
          return seg;
        }
      })
      .join("/");
    const { exp, sig } = req.query as { exp?: string; sig?: string };
    if (!exp || !sig || !storage.verify(key, Number(exp), sig)) throw forbidden("Invalid or expired link");

    const file = await storage.get(key);
    if (!file) throw notFound("File not found");
    reply.header("Cache-Control", "private, max-age=300");
    if (file.contentType) reply.header("Content-Type", file.contentType);
    return reply.send(file.data);
  });
}

import type { FastifyInstance } from "fastify";
import { storage } from "../lib/storage.js";
import { forbidden, notFound } from "../lib/errors.js";

/**
 * Signed file delivery (§11.5). The signature + expiry ARE the authorization — raw
 * storage keys are never usable without a valid signature. Bytes come from Postgres.
 */
export async function registerFileRoutes(app: FastifyInstance) {
  app.get("/files/:key", async (req, reply) => {
    const { key } = req.params as { key: string };
    const { exp, sig } = req.query as { exp?: string; sig?: string };
    if (!exp || !sig || !storage.verify(key, Number(exp), sig)) throw forbidden("Invalid or expired link");

    const file = await storage.get(key);
    if (!file) throw notFound("File not found");
    reply.header("Cache-Control", "private, max-age=300");
    if (file.contentType) reply.header("Content-Type", file.contentType);
    return reply.send(file.data);
  });
}

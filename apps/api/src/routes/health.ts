import type { FastifyInstance } from "fastify";

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get("/api/health", async () => ({ ok: true, ts: new Date().toISOString() }));
}

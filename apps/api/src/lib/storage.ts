import { createHmac, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, fileBlobs } from "@smart-crm/db";
import { env } from "../env.js";

/**
 * File storage behind one interface (§7, §11.5). Bytes live in Postgres (file_blobs),
 * so uploads survive redeploys and work across multiple app servers with no shared disk.
 * Files are NEVER served from a raw path — reads go through short-lived signed URLs whose
 * HMAC signature + expiry ARE the authorization.
 */
export interface StorageDriver {
  put(key: string, data: Buffer, contentType?: string | null): Promise<void>;
  get(key: string): Promise<{ data: Buffer; contentType: string | null } | null>;
  delete(key: string): Promise<void>;
  /** A signed, expiring URL the browser can fetch (§11.5). */
  signedUrl(key: string, ttlSeconds?: number): string;
  /** Verify a signature + expiry for the file delivery route. */
  verify(key: string, exp: number, sig: string): boolean;
}

function sign(key: string, exp: number): string {
  return createHmac("sha256", env.authSecret).update(`${key}:${exp}`).digest("hex");
}

class DbStorage implements StorageDriver {
  async put(key: string, data: Buffer, contentType?: string | null) {
    const values = { key, data, contentType: contentType ?? null, byteSize: data.byteLength };
    await db
      .insert(fileBlobs)
      .values(values)
      .onConflictDoUpdate({ target: fileBlobs.key, set: { data, contentType: contentType ?? null, byteSize: data.byteLength } });
  }

  async get(key: string) {
    const [row] = await db
      .select({ data: fileBlobs.data, contentType: fileBlobs.contentType })
      .from(fileBlobs)
      .where(eq(fileBlobs.key, key))
      .limit(1);
    if (!row) return null;
    // postgres-js returns bytea as a Buffer/Uint8Array — normalise to Buffer.
    const data = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data as Uint8Array);
    return { data, contentType: row.contentType ?? null };
  }

  async delete(key: string) {
    await db.delete(fileBlobs).where(eq(fileBlobs.key, key));
  }

  signedUrl(key: string, ttlSeconds = 600): string {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = sign(key, exp);
    // Encode each path SEGMENT but keep the "/" separators literal — behind
    // IIS/ARR a percent-encoded %2F is decoded before the request reaches the
    // API, so the delivery route matches on the full multi-segment key. The
    // signature is over the raw key; routes/files.ts decodes back to it.
    const path = key.split("/").map(encodeURIComponent).join("/");
    return `/files/${path}?exp=${exp}&sig=${sig}`;
  }

  verify(key: string, exp: number, sig: string): boolean {
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
    return sign(key, exp) === sig;
  }
}

export const storage: StorageDriver = new DbStorage();

/** Generate a storage key that preserves the original extension. */
export function newStorageKey(filename: string): string {
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
  return `${randomUUID()}${ext}`;
}

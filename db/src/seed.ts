import "./loadenv.js";
import { randomBytes, createHash } from "node:crypto";
import { db, sql } from "./client.js";
import { users, userTokens, statusStages, products, organizations } from "./schema.js";
import { sql as dsql, eq } from "drizzle-orm";

/** Default organization for the seeded (single-tenant) workspace. */
const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";

async function ensureOrg() {
  await db
    .insert(organizations)
    .values({ id: DEFAULT_ORG_ID, name: process.env.SEED_ORG_NAME ?? "Smart HVAC Solutions" })
    .onConflictDoNothing({ target: organizations.id });
}

/**
 * Idempotent seed (build plan §3):
 *  - First Super Admin = Tom, seeded by email, then issued a set-password invite (§3.1).
 *  - Product list (§3.3a / §16 Q2).
 *  - Status stages new→…→won→lost with the conversion + terminal flags (§5.2).
 * Re-running is safe: existing rows are left untouched.
 */

const DEFAULT_STAGES = [
  { key: "new", label: "New", sortOrder: 1, isConversion: false, isTerminal: false },
  { key: "contacted", label: "Contacted", sortOrder: 2, isConversion: false, isTerminal: false },
  { key: "demo_scheduled", label: "Demo Scheduled", sortOrder: 3, isConversion: false, isTerminal: false },
  { key: "proposal", label: "Proposal", sortOrder: 4, isConversion: false, isTerminal: false },
  { key: "won", label: "Won", sortOrder: 5, isConversion: true, isTerminal: true },
  { key: "lost", label: "Lost", sortOrder: 6, isConversion: false, isTerminal: true },
];

const DEFAULT_PRODUCTS = [
  "Smart Plan Survey",
  "Smart Plan Propose",
  "Smart Plan Quote",
  "Smart Plan Perform",
  "Equipment Only Survey",
  "Equipment Only Perform",
];

async function seedStages() {
  for (const s of DEFAULT_STAGES) {
    await db
      .insert(statusStages)
      .values({ ...s, orgId: DEFAULT_ORG_ID })
      .onConflictDoNothing();
  }
  console.log(`✓ status stages (${DEFAULT_STAGES.length})`);
}

async function seedProducts() {
  const existing = await db.select({ label: products.label }).from(products).where(eq(products.orgId, DEFAULT_ORG_ID));
  const have = new Set(existing.map((r) => r.label));
  let added = 0;
  for (let i = 0; i < DEFAULT_PRODUCTS.length; i++) {
    const label = DEFAULT_PRODUCTS[i]!;
    if (have.has(label)) continue;
    await db.insert(products).values({ label, sortOrder: i + 1, active: true, orgId: DEFAULT_ORG_ID });
    added++;
  }
  console.log(`✓ products (${added} added, ${have.size} existing)`);
}

async function seedSuperAdmin() {
  const email = (process.env.SEED_SUPERADMIN_EMAIL ?? "tomw@smarthvac.solutions").trim();
  const name = process.env.SEED_SUPERADMIN_NAME ?? "Tom Walton";

  const found = await db
    .select({ id: users.id })
    .from(users)
    .where(dsql`lower(${users.email}) = lower(${email})`)
    .limit(1);

  if (found.length > 0) {
    console.log(`✓ super admin already present (${email})`);
    return;
  }

  const [created] = await db
    .insert(users)
    .values({
      role: "super_admin",
      orgId: DEFAULT_ORG_ID,
      fullName: name,
      email,
      active: true,
      invitedAt: new Date(),
    })
    .returning({ id: users.id });

  // Issue a set-password invite token (valid 7 days).
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expires = new Date();
  expires.setDate(expires.getDate() + 7);
  await db.insert(userTokens).values({
    userId: created!.id,
    tokenHash,
    purpose: "invite",
    expiresAt: expires,
  });

  const webOrigin = (process.env.WEB_ORIGIN ?? "http://localhost:5173").split(",")[0];
  console.log(`✓ super admin created: ${email}`);
  console.log("\n  Set-password invite link (dev — would normally be emailed):");
  console.log(`  ${webOrigin}/set-password?token=${rawToken}\n`);
}

async function main() {
  await ensureOrg();
  await seedStages();
  await seedProducts();
  await seedSuperAdmin();
  await sql.end();
  console.log("✓ seed complete");
}

main().catch(async (err) => {
  console.error("seed failed:", err);
  await sql.end();
  process.exit(1);
});

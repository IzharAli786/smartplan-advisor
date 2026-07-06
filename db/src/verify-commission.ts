import "./loadenv.js";
import { randomBytes, createHash } from "node:crypto";
import { db, sql } from "./client.js";
import { users, userTokens } from "./schema.js";
import { sql as dsql } from "drizzle-orm";

/**
 * Proves effective-dated commission (§10): a deal earns the rate effective on its
 * conversion date, and later/future rate changes never alter past deals. Creates a
 * throwaway advisor + deal, asserts the report, then deletes all of its own test data.
 *
 * Run the API first, then: pnpm --filter @smart-crm/db verify:commission
 */
const API = process.env.SMOKE_API ?? "http://localhost:4000";
let passed = 0,
  failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`, detail ?? ""); }
}

class Session {
  private cookie = "";
  async req(method: string, path: string, body?: unknown) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0]!;
    const ct = res.headers.get("content-type") ?? "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = ct.includes("json") ? await res.json() : await res.text();
    return { status: res.status, json };
  }
}

async function setPassword(email: string, password: string) {
  const [u] = await db.select({ id: users.id }).from(users).where(dsql`lower(${users.email}) = lower(${email})`).limit(1);
  const raw = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(raw).digest("hex");
  await db.insert(userTokens).values({ userId: u!.id, tokenHash: hash, purpose: "invite", expiresAt: new Date(Date.now() + 3600_000) });
  await new Session().req("POST", "/api/auth/set-password", { token: raw, password });
  return u!.id;
}

async function reportRate(tom: Session, company: string): Promise<{ rate: number; amount: number } | null> {
  const rep = await tom.req("GET", "/api/reports/converted?from=2000-01-01&to=2999-12-31");
  const row = (rep.json.rows as any[]).find((r) => r.company === company);
  return row ? { rate: row.commissionRateSnapshot, amount: row.commissionAmount } : null;
}

async function main() {
  console.log(`\nCommission effective-dating verification → ${API}\n`);
  const tag = randomBytes(3).toString("hex");
  const email = `rate.test.${tag}@example.com`;
  const company = `RateTest ${tag} HVAC`;

  const tom = new Session();
  await setPassword(process.env.SEED_SUPERADMIN_EMAIL ?? "tomw@smarthvac.solutions", "supersecret123");
  await tom.req("POST", "/api/auth/login", { email: process.env.SEED_SUPERADMIN_EMAIL ?? "tomw@smarthvac.solutions", password: "supersecret123" });

  // Advisor with an initial 30% rate effective 2026-01-01.
  await tom.req("POST", "/api/users", { full_name: `Rate Test ${tag}`, email, role: "advisor", states_covered: ["CO"], current_commission_rate: 30, start_date: "2026-01-01" });
  const advisorId = await setPassword(email, "ratetest12345");

  const adv = new Session();
  await adv.req("POST", "/api/auth/login", { email, password: "ratetest12345" });
  const opp = await adv.req("POST", "/api/opportunities", { contractor_company_name: company, product: "Smart Plan Survey", state: "CO", opportunity_value: 10000 });
  const oppId = opp.json.opportunity.id;
  await adv.req("POST", `/api/opportunities/${oppId}/convert`, { deal_value: 10000 });

  let r = await reportRate(tom, company);
  check("converts at the effective rate (30% of 10000 = 3000)", !!r && r.rate === 30 && r.amount === 3000, r);

  // FUTURE rate change must NOT affect the already-converted deal.
  await tom.req("PATCH", `/api/users/${advisorId}`, { current_commission_rate: 50, commission_effective_from: "2099-01-01" });
  r = await reportRate(tom, company);
  check("future rate change does NOT alter past deal (still 30%)", !!r && r.rate === 30 && r.amount === 3000, r);

  // A change effective BEFORE the conversion date DOES apply in the report.
  await tom.req("PATCH", `/api/users/${advisorId}`, { current_commission_rate: 60, commission_effective_from: "2026-02-01" });
  r = await reportRate(tom, company);
  check("past-dated rate change applies (60% of 10000 = 6000)", !!r && r.rate === 60 && r.amount === 6000, r);

  // History should hold all three entries.
  const hist = await tom.req("GET", `/api/users/${advisorId}/commission-history`);
  check("commission history has 3 entries", (hist.json.history as any[]).length === 3, hist.json);

  // ── Clean up all test data so the user's reports stay accurate ──
  await db.execute(dsql`DELETE FROM transactions WHERE advisor_id = ${advisorId}`);
  await db.execute(dsql`DELETE FROM opportunities WHERE advisor_id = ${advisorId}`);
  await db.execute(dsql`DELETE FROM commission_rates WHERE advisor_id = ${advisorId}`);
  await db.execute(dsql`DELETE FROM user_tokens WHERE user_id = ${advisorId}`);
  await db.execute(dsql`DELETE FROM users WHERE id = ${advisorId}`);
  console.log("  ✓ cleaned up test data");

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await sql.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => { console.error("verify crashed:", err); await sql.end(); process.exit(1); });

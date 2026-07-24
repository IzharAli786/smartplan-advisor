import "./loadenv.js";
import { randomBytes, createHash } from "node:crypto";
import { db, sql } from "./client.js";
import { users, userTokens } from "./schema.js";
import { sql as dsql } from "drizzle-orm";

/**
 * SmartPlan webhook behaviour ACROSS A TAKEOVER (§5.1).
 *
 * SmartPlan only ever knows the advisor who originally referred the customer. These
 * endpoints used to resolve the account by `advisor_id + company`, so once a referral
 * account was transferred the webhooks silently stopped finding it: recurring revenue kept
 * accruing to the previous advisor, a re-activation minted a duplicate opportunity under
 * them, and subscription events stopped converting the deal that had actually moved.
 *
 * Run the API first, then: pnpm --filter @smart-crm/db verify:takeover-webhooks
 */
const API = process.env.SMOKE_API ?? "http://localhost:4000";
const SECRET = process.env.SMARTPLAN_INGEST_SECRET ?? "";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`, detail ?? "");
  }
}

class Session {
  private cookie = "";
  async req(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0]!;
    const ct = res.headers.get("content-type") ?? "";
    return { status: res.status, json: ct.includes("application/json") ? await res.json() : await res.text() };
  }
}

/** Server-to-server call — shared secret, no session. */
async function ingest(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API}/api/smartplan-transactions${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ingest-secret": SECRET },
    body: JSON.stringify(body),
  });
  const ct = res.headers.get("content-type") ?? "";
  return { status: res.status, json: ct.includes("application/json") ? await res.json() : await res.text() };
}

async function setPassword(email: string, password: string) {
  const [u] = await db.select({ id: users.id }).from(users).where(dsql`lower(${users.email}) = lower(${email})`).limit(1);
  if (!u) throw new Error(`user not found: ${email}`);
  const raw = randomBytes(32).toString("hex");
  await db.insert(userTokens).values({
    userId: u.id,
    tokenHash: createHash("sha256").update(raw).digest("hex"),
    purpose: "invite",
    expiresAt: new Date(Date.now() + 3600_000),
  });
  const r = await new Session().req("POST", "/api/auth/set-password", { token: raw, password });
  if (r.status !== 200) throw new Error(`set-password failed for ${email}: ${JSON.stringify(r.json)}`);
}

async function main() {
  console.log(`\nTakeover webhook verification → ${API}\n`);
  if (!SECRET) {
    console.error("SMARTPLAN_INGEST_SECRET is not set — the ingest endpoints are disabled. Skipping.");
    await sql.end();
    process.exit(1);
  }

  const tomEmail = process.env.SEED_SUPERADMIN_EMAIL ?? "tomw@smarthvac.solutions";
  await setPassword(tomEmail, "supersecret123");
  const tom = new Session();
  await tom.req("POST", "/api/auth/login", { email: tomEmail, password: "supersecret123" });

  const tag = randomBytes(3).toString("hex");
  const emailA = `wh.a.${tag}@example.com`;
  const emailB = `wh.b.${tag}@example.com`;
  const ca = await tom.req("POST", "/api/users", { full_name: "Webhook A", email: emailA, role: "advisor", states_covered: ["CO"], current_commission_rate: 10 });
  const cb = await tom.req("POST", "/api/users", { full_name: "Webhook B", email: emailB, role: "advisor", states_covered: ["CO"], current_commission_rate: 12 });
  const advisorAId = ca.json.user?.id;
  const advisorBId = cb.json.user?.id;
  check("created both advisors", !!advisorAId && !!advisorBId, { ca: ca.json, cb: cb.json });

  await setPassword(emailA, "advisora123");
  await setPassword(emailB, "advisorb123");
  const b = new Session();
  await b.req("POST", "/api/auth/login", { email: emailB, password: "advisorb123" });

  // 1. SmartPlan activates a referred customer under advisor A.
  const company = `Referral ${tag} Heating & Cooling LLC`;
  const act = await ingest("/activation", {
    advisor_id: advisorAId,
    company_name: company,
    contact_email: `owner.${tag}@referral.com`,
    product: "Smart Plan Survey",
    opportunity_value: 4000,
    state: "CO",
  });
  const oppId = act.json.opportunity_id;
  check("activation creates a referral opportunity under A", act.status === 200 && !!oppId && act.json.deduped === false, act.json);

  // 2. Advisor B is blocked on the same company and a manager approves the takeover.
  //    SmartPlan sends the LEGAL billing name; the advisor types the everyday one. The
  //    territory block is exact, so B must type the same name to collide with it.
  const blocked = await b.req("POST", "/api/opportunities", {
    contractor_company_name: company,
    product: "Smart Plan Survey",
    state: "CO",
  });
  check("advisor B blocked on the referral account (409)", blocked.status === 409 && blocked.json.code === "territory_blocked", blocked);

  const claims = await tom.req("GET", "/api/claim-requests?status=pending");
  const claim = (claims.json.claimRequests ?? []).find((c: any) => c.matchedOpportunityId === oppId);
  check("takeover request raised for the referral account", !!claim, claims.json);
  const decide = await tom.req("POST", `/api/claim-requests/${claim?.id}/decide`, { decision: "approved" });
  check("manager approves the takeover to B", decide.status === 200 && decide.json.status === "approved", decide.json);

  const [owner] = await db.execute<{ advisor_id: string }>(dsql`SELECT advisor_id FROM opportunities WHERE id = ${oppId}::uuid`);
  check("account is now owned by B", owner?.advisor_id === advisorBId, owner);

  // 3. Stripe replays revenue carrying A's advisor_id — it must land on B.
  const txnId = `in_test_${tag}`;
  const ing = await ingest("/ingest", {
    advisor_id: advisorAId, // SmartPlan still thinks A owns this customer
    stripe_transaction_id: txnId,
    amount: 199,
    company_name: company,
    status: "active",
    product: "Smart Plan",
  });
  check("ingest accepted", ing.status === 200, ing.json);
  const [txn] = await db.execute<{ advisor_id: string }>(
    dsql`SELECT advisor_id FROM smartplan_transactions WHERE stripe_transaction_id = ${txnId}`,
  );
  check("recurring revenue follows the account to B", txn?.advisor_id === advisorBId, { expected: advisorBId, got: txn?.advisor_id });

  // 4. A re-activation must dedupe against the TRANSFERRED account, not mint a second one
  //    under the original referrer.
  const act2 = await ingest("/activation", { advisor_id: advisorAId, company_name: company, product: "Smart Plan Survey", state: "CO" });
  check("re-activation dedupes to the same opportunity", act2.json.deduped === true && act2.json.opportunity_id === oppId, act2.json);
  const dupes = await db.execute<{ n: number }>(
    dsql`SELECT count(*)::int AS n FROM opportunities WHERE advisor_id IN (${advisorAId}::uuid, ${advisorBId}::uuid) AND source = 'referral'`,
  );
  check("no duplicate referral opportunity was created", dupes[0]?.n === 1, dupes[0]);

  // 5. The subscription event must resolve org-wide and convert under B.
  const sub = await ingest("/subscription-status", { advisor_id: advisorAId, company_name: company, event: "subscribed" });
  check("subscription event resolves the transferred account", sub.status === 200 && sub.json.updated === true, sub.json);
  const [conv] = await db.execute<{ advisor_id: string; voided_at: string | null }>(
    dsql`SELECT advisor_id, voided_at FROM transactions WHERE opportunity_id = ${oppId}::uuid`,
  );
  check("the conversion is credited to B, the current owner", conv?.advisor_id === advisorBId && conv?.voided_at === null, conv);

  // ── Teardown ──
  const adv = dsql`(SELECT id FROM users WHERE lower(email) IN (lower(${emailA}), lower(${emailB})))`;
  const opps = dsql`(SELECT id FROM opportunities WHERE advisor_id IN ${adv})`;
  await db.execute(dsql`DELETE FROM smartplan_transactions WHERE advisor_id IN ${adv}`);
  await db.execute(dsql`DELETE FROM transactions WHERE advisor_id IN ${adv} OR opportunity_id IN ${opps}`);
  await db.execute(dsql`DELETE FROM claim_requests WHERE requesting_advisor_id IN ${adv} OR current_owner_id IN ${adv}`);
  await db.execute(dsql`DELETE FROM activities WHERE advisor_id IN ${adv} OR opportunity_id IN ${opps}`);
  await db.execute(dsql`DELETE FROM communications WHERE advisor_id IN ${adv}`);
  await db.execute(dsql`DELETE FROM opportunities WHERE advisor_id IN ${adv}`);
  await db.execute(dsql`DELETE FROM commission_rates WHERE advisor_id IN ${adv}`);
  await db.execute(dsql`DELETE FROM notifications WHERE user_id IN ${adv}`);
  await db.execute(dsql`DELETE FROM user_tokens WHERE user_id IN ${adv}`);
  await db.execute(dsql`DELETE FROM users WHERE id IN ${adv}`);
  console.log("  ✓ cleaned up test data");

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await sql.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("verification crashed:", err);
  await sql.end();
  process.exit(1);
});

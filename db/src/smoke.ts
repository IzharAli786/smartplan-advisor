import "./loadenv.js";
import { randomBytes, createHash } from "node:crypto";
import { db, sql } from "./client.js";
import { users, userTokens } from "./schema.js";
import { sql as dsql, eq } from "drizzle-orm";

/**
 * End-to-end smoke test against a RUNNING API (default http://localhost:4000).
 * Exercises the v1 acceptance-critical paths:
 *   auth + invite/set-password, RBAC (advisor 403 on user mgmt), opportunity capture,
 *   territory block + claim-request + manager approval/reassignment, conversion +
 *   commission snapshot, commission-stripping for advisors, converted report.
 *
 * Run the API first (pnpm api:dev), migrate + seed, then: pnpm --filter @smart-crm/db smoke
 */
const API = process.env.SMOKE_API ?? "http://localhost:4000";

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

/** Minimal cookie jar per session. */
class Session {
  private cookie = "";
  async req(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0]!;
    const ct = res.headers.get("content-type") ?? "";
    const json = ct.includes("application/json") ? await res.json() : await res.text();
    return { status: res.status, json };
  }
}

/** Issue an invite token directly + set the password through the real API. */
async function setPassword(email: string, password: string) {
  const [u] = await db.select({ id: users.id }).from(users).where(dsql`lower(${users.email}) = lower(${email})`).limit(1);
  if (!u) throw new Error(`user not found: ${email}`);
  const raw = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(raw).digest("hex");
  await db.insert(userTokens).values({
    userId: u.id,
    tokenHash: hash,
    purpose: "invite",
    expiresAt: new Date(Date.now() + 3600_000),
  });
  const s = new Session();
  const r = await s.req("POST", "/api/auth/set-password", { token: raw, password });
  if (r.status !== 200) throw new Error(`set-password failed for ${email}: ${JSON.stringify(r.json)}`);
}

async function main() {
  console.log(`\nSmoke test → ${API}\n`);

  // Health
  const health = await new Session().req("GET", "/api/health");
  check("API health", health.status === 200 && health.json.ok === true, health);

  const tomEmail = process.env.SEED_SUPERADMIN_EMAIL ?? "tomw@smarthvac.solutions";
  await setPassword(tomEmail, "supersecret123");

  const tom = new Session();
  const login = await tom.req("POST", "/api/auth/login", { email: tomEmail, password: "supersecret123" });
  check("super admin login", login.status === 200 && login.json.user.role === "super_admin", login.json);
  check("commission hidden for super admin? (managerial sees it)", "currentCommissionRate" in login.json.user, login.json.user);

  // Create two advisors (unique emails per run).
  const tag = randomBytes(3).toString("hex");
  const emailA = `advisor.a.${tag}@example.com`;
  const emailB = `advisor.b.${tag}@example.com`;
  const ca = await tom.req("POST", "/api/users", { full_name: "Advisor A", email: emailA, role: "advisor", states_covered: ["CO"], current_commission_rate: 10 });
  const cb = await tom.req("POST", "/api/users", { full_name: "Advisor B", email: emailB, role: "advisor", states_covered: ["CO"], current_commission_rate: 12 });
  check("create advisor A", ca.status === 200, ca.json);
  check("create advisor B", cb.status === 200, cb.json);

  await setPassword(emailA, "advisora123");
  await setPassword(emailB, "advisorb123");

  const a = new Session();
  await a.req("POST", "/api/auth/login", { email: emailA, password: "advisora123" });
  const b = new Session();
  await b.req("POST", "/api/auth/login", { email: emailB, password: "advisorb123" });

  // RBAC: advisor cannot create users (403) and cannot list roster (403).
  const advCreate = await a.req("POST", "/api/users", { full_name: "X", email: `x.${tag}@e.com`, role: "advisor" });
  check("advisor blocked from creating users (403)", advCreate.status === 403, advCreate);
  const advList = await a.req("GET", "/api/users");
  check("advisor blocked from user roster (403)", advList.status === 403, advList);

  // Commission never reaches advisor: /me has no commission field.
  const meA = await a.req("GET", "/api/auth/me");
  check("commission stripped from advisor /me", !("currentCommissionRate" in meA.json.user), meA.json.user);

  // Advisor A creates an opportunity (unique company per run to isolate dedupe).
  const company = `Acme ${tag} Mechanical`;
  const oppA = await a.req("POST", "/api/opportunities", {
    contractor_company_name: company,
    product: "Smart Plan Survey",
    state: "CO",
    contact_email: `ops.${tag}@acme.com`,
    opportunity_value: 5000,
  });
  check("advisor A creates opportunity", oppA.status === 200 && oppA.json.opportunity?.id, oppA.json);
  const oppAId = oppA.json.opportunity?.id;

  // Advisor B tries the same company → territory block + claim request.
  const oppB = await b.req("POST", "/api/opportunities", {
    contractor_company_name: `${company} Inc`,
    product: "Smart Plan Survey",
    state: "CO",
  });
  check("advisor B blocked by territory (409)", oppB.status === 409 && oppB.json.code === "territory_blocked", oppB);

  // Manager sees the claim request and approves it.
  const claims = await tom.req("GET", "/api/claim-requests?status=pending");
  const claim = claims.json.claimRequests?.find((c: any) => c.matchedOpportunityId === oppAId);
  check("claim request raised + visible to manager", !!claim, claims.json);
  const decide = await tom.req("POST", `/api/claim-requests/${claim.id}/decide`, { decision: "approved" });
  check("manager approves takeover", decide.status === 200 && decide.json.status === "approved", decide.json);

  // Ownership transferred to B: A no longer sees it; B does.
  const aList = await a.req("GET", "/api/opportunities");
  const bList = await b.req("GET", "/api/opportunities");
  check("opportunity removed from A's pipeline", !aList.json.opportunities.some((o: any) => o.id === oppAId), aList.json);
  check("opportunity now in B's pipeline", bList.json.opportunities.some((o: any) => o.id === oppAId), bList.json);

  // B converts it → transaction with commission snapshot (12%).
  const convert = await b.req("POST", `/api/opportunities/${oppAId}/convert`, { deal_value: 8000 });
  check("advisor B converts opportunity", convert.status === 200, convert.json);

  // Manager report shows the conversion with commission (8000 * 12% = 960).
  const report = await tom.req("GET", "/api/reports/converted?from=2000-01-01&to=2999-01-01");
  const row = report.json.rows?.find((r: any) => r.dealValue === 8000);
  check("converted report includes the deal", !!row, report.json);
  check("commission snapshot computed (12% of 8000 = 960)", row && row.commissionRateSnapshot === 12 && row.commissionAmount === 960, row);

  // Today endpoint works for an advisor.
  const today = await b.req("GET", "/api/today");
  check("today endpoint responds", today.status === 200 && Array.isArray(today.json.items), today.json);

  // Settings readable; product seed present.
  const products = await a.req("GET", "/api/settings/products");
  check("seeded products present", products.json.products?.length >= 6, products.json);

  // Collateral (M7): manager adds a video link; advisor can browse + get a share link.
  const addCollateral = await tom.req("POST", "/api/collateral", {
    product: "Smart Plan Survey",
    type: "video",
    title: `Demo video ${tag}`,
    external_url: "https://youtube.com/watch?v=demo",
    sort_order: 0,
  });
  check("manager adds collateral", addCollateral.status === 200, addCollateral.json);
  const advisorAddCollateral = await a.req("POST", "/api/collateral", {
    product: "Smart Plan Survey",
    type: "link",
    title: "should fail",
    external_url: "https://x.com",
  });
  check("advisor blocked from adding collateral (403)", advisorAddCollateral.status === 403, advisorAddCollateral);
  const lib = await a.req("GET", "/api/collateral?product=Smart%20Plan%20Survey");
  const collateralItem = lib.json.collateral?.find((c: any) => c.title === `Demo video ${tag}`);
  check("advisor browses collateral by product", !!collateralItem, lib.json);
  const share = await a.req("GET", `/api/collateral/${collateralItem?.id}/share`);
  check("advisor gets shareable collateral link", share.status === 200 && !!share.json.url, share.json);

  // ── Clean up everything this run created, so the roster/reports stay accurate ──
  const adv = dsql`(SELECT id FROM users WHERE lower(email) IN (lower(${emailA}), lower(${emailB})))`;
  const opps = dsql`(SELECT id FROM opportunities WHERE advisor_id IN ${adv})`;
  await db.execute(dsql`DELETE FROM transactions WHERE advisor_id IN ${adv}`);
  await db.execute(dsql`DELETE FROM quote_line_items WHERE quote_id IN (SELECT id FROM quotes WHERE advisor_id IN ${adv})`);
  await db.execute(dsql`DELETE FROM quotes WHERE advisor_id IN ${adv}`);
  await db.execute(dsql`DELETE FROM claim_requests WHERE requesting_advisor_id IN ${adv} OR current_owner_id IN ${adv}`);
  await db.execute(dsql`DELETE FROM activities WHERE advisor_id IN ${adv} OR opportunity_id IN ${opps}`);
  await db.execute(dsql`DELETE FROM opportunities WHERE advisor_id IN ${adv}`);
  await db.execute(dsql`DELETE FROM commission_rates WHERE advisor_id IN ${adv}`);
  await db.execute(dsql`DELETE FROM notifications WHERE user_id IN ${adv}`);
  await db.execute(dsql`DELETE FROM user_tokens WHERE user_id IN ${adv}`);
  await db.execute(dsql`DELETE FROM users WHERE id IN ${adv}`);
  await db.execute(dsql`DELETE FROM collateral WHERE title = ${`Demo video ${tag}`}`);
  console.log("  ✓ cleaned up test data");

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await sql.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("smoke crashed:", err);
  await sql.end();
  process.exit(1);
});

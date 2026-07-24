import { sql as dsql } from "drizzle-orm";
import { db } from "@smart-crm/db";

/**
 * Duplicate / territory matcher (§5.1). Matches a candidate against ALL opportunities on:
 *   - EXACT company_key equality (case- and punctuation-insensitive), OR
 *   - exact normalized contact email, OR
 *   - exact E.164 contact cell.
 *
 * Company matching is exact by design. It used to be pg_trgm similarity >= 0.6 over
 * company_name_normalized — a key that also deletes noise tokens (inc, llc, hvac,
 * services...) — which meant "Acme HVAC" blocked "Acme Plumbing" and "Acme Inc" blocked
 * "Acme LLC". A block stops real work until a manager approves, so a false match is far
 * more expensive than a missed one. company_key strips only case and punctuation:
 *
 *   "Acme, Inc." = "acme inc"      → same account, blocks
 *   "Acme Inc"  != "Acme LLC"      → different accounts, no block
 *
 * See normalizeCompanyKey() in @smart-crm/shared. company_name_normalized and its GIN
 * index still exist and are still used by the SmartPlan/Stripe lookups, which need the
 * tolerant key to match legal billing names — they just don't go through here.
 */

/** Which signal matched — surfaced to the manager so they know WHY the save was blocked. */
export type MatchedOn = "company" | "email" | "phone";

export interface MatchRow {
  id: string;
  advisorId: string;
  ownerName: string;
  contractorCompanyName: string;
  status: string;
  statusLabel: string;
  isTerminal: boolean;
  isConversion: boolean;
  matchedOn: MatchedOn;
  /** Decision context for the takeover queue — how real is the incumbent's claim? */
  source: string;
  opportunityValue: number | null;
  createdAt: Date;
  lastActivityAt: Date | null;
}

export interface DedupeResult {
  /** The advisor already has this account — warn/dedupe, not a conflict (§5.1). */
  ownMatch: MatchRow | null;
  /** Active account held by ANOTHER advisor — blocks the save, raises a claim request. */
  conflict: MatchRow | null;
}

export async function findMatches(args: {
  orgId: string;
  requestingAdvisorId: string;
  companyKey: string;
  contactEmailNormalized: string | null;
  contactCellE164: string | null;
}): Promise<DedupeResult> {
  const { orgId, requestingAdvisorId, companyKey, contactEmailNormalized, contactCellE164 } = args;

  // Built once and reused in WHERE and in the matched_on CASE so the two can never disagree.
  const companyPred = dsql`(${companyKey}::text <> '' AND o.company_key = ${companyKey})`;
  const emailPred = dsql`(${contactEmailNormalized}::text IS NOT NULL AND o.contact_email_normalized = ${contactEmailNormalized})`;
  const cellPred = dsql`(${contactCellE164}::text IS NOT NULL AND o.contact_cell_e164 = ${contactCellE164})`;

  const rows = await db.execute<{
    id: string;
    advisor_id: string;
    owner_name: string;
    contractor_company_name: string;
    status: string;
    status_label: string;
    is_terminal: boolean;
    is_conversion: boolean;
    matched_on: MatchedOn;
    source: string;
    opportunity_value: string | null;
    created_at: Date;
    last_activity_at: Date | null;
  }>(dsql`
    SELECT o.id,
           o.advisor_id,
           u.full_name AS owner_name,
           o.contractor_company_name,
           o.status,
           s.label AS status_label,
           s.is_terminal,
           s.is_conversion,
           o.source,
           o.opportunity_value,
           o.created_at,
           o.last_activity_at,
           CASE WHEN ${companyPred} THEN 'company'
                WHEN ${emailPred}   THEN 'email'
                ELSE 'phone' END AS matched_on
    FROM opportunities o
    JOIN users u ON u.id = o.advisor_id
    JOIN status_stages s ON s.org_id = o.org_id AND s.key = o.status
    WHERE o.org_id = ${orgId}
      AND (${companyPred} OR ${emailPred} OR ${cellPred})
    -- A company-name hit outranks a contact hit: the claim request and the block message
    -- should point at the account the advisor actually tried to create.
    ORDER BY (CASE WHEN ${companyPred} THEN 0 ELSE 1 END), o.last_activity_at DESC NULLS LAST
  `);

  const matches: MatchRow[] = rows.map((r) => ({
    id: r.id,
    advisorId: r.advisor_id,
    ownerName: r.owner_name,
    contractorCompanyName: r.contractor_company_name,
    status: r.status,
    statusLabel: r.status_label,
    isTerminal: r.is_terminal,
    isConversion: r.is_conversion,
    matchedOn: r.matched_on,
    source: r.source,
    opportunityValue: r.opportunity_value == null ? null : Number(r.opportunity_value),
    createdAt: r.created_at,
    lastActivityAt: r.last_activity_at,
  }));

  const ownMatch = matches.find((m) => m.advisorId === requestingAdvisorId) ?? null;

  // A "lost" account (terminal, non-conversion) frees the territory — it does not block.
  // Open accounts and won (converted) accounts are owned, so they block another advisor.
  const conflict =
    matches.find((m) => m.advisorId !== requestingAdvisorId && !(m.isTerminal && !m.isConversion)) ?? null;

  return { ownMatch, conflict };
}

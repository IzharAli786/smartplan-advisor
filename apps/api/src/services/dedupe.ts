import { sql as dsql } from "drizzle-orm";
import { db } from "@smart-crm/db";

/**
 * Duplicate / territory matcher (§5.1). Matches a candidate against ALL opportunities on:
 *   - company_name_normalized similarity (pg_trgm ≥ 0.6, conservative per §5.1), OR
 *   - exact normalized contact email, OR
 *   - exact E.164 contact cell.
 *
 * Threshold is deliberately conservative — favour a few missed dupes over false blocks,
 * because a block now stops real work until a manager approves (§5.1).
 *
 * Reused for Apollo enrichment + lead dedupe in v1.1.
 */
export const COMPANY_SIMILARITY_THRESHOLD = 0.6;

export interface MatchRow {
  id: string;
  advisorId: string;
  ownerName: string;
  contractorCompanyName: string;
  status: string;
  isTerminal: boolean;
  isConversion: boolean;
  similarity: number;
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
  companyNameNormalized: string;
  contactEmailNormalized: string | null;
  contactCellE164: string | null;
}): Promise<DedupeResult> {
  const { orgId, requestingAdvisorId, companyNameNormalized, contactEmailNormalized, contactCellE164 } = args;

  const rows = await db.execute<{
    id: string;
    advisor_id: string;
    owner_name: string;
    contractor_company_name: string;
    status: string;
    is_terminal: boolean;
    is_conversion: boolean;
    sim: number;
  }>(dsql`
    SELECT o.id,
           o.advisor_id,
           u.full_name AS owner_name,
           o.contractor_company_name,
           o.status,
           s.is_terminal,
           s.is_conversion,
           similarity(o.company_name_normalized, ${companyNameNormalized}) AS sim
    FROM opportunities o
    JOIN users u ON u.id = o.advisor_id
    JOIN status_stages s ON s.org_id = o.org_id AND s.key = o.status
    WHERE o.org_id = ${orgId}
      AND (similarity(o.company_name_normalized, ${companyNameNormalized}) >= ${COMPANY_SIMILARITY_THRESHOLD}
       OR (${contactEmailNormalized}::text IS NOT NULL AND o.contact_email_normalized = ${contactEmailNormalized})
       OR (${contactCellE164}::text IS NOT NULL AND o.contact_cell_e164 = ${contactCellE164}))
    ORDER BY sim DESC
  `);

  const matches: MatchRow[] = rows.map((r) => ({
    id: r.id,
    advisorId: r.advisor_id,
    ownerName: r.owner_name,
    contractorCompanyName: r.contractor_company_name,
    status: r.status,
    isTerminal: r.is_terminal,
    isConversion: r.is_conversion,
    similarity: Number(r.sim),
  }));

  const ownMatch = matches.find((m) => m.advisorId === requestingAdvisorId) ?? null;

  // A "lost" account (terminal, non-conversion) frees the territory — it does not block.
  // Open accounts and won (converted) accounts are owned, so they block another advisor.
  const conflict =
    matches.find((m) => m.advisorId !== requestingAdvisorId && !(m.isTerminal && !m.isConversion)) ?? null;

  return { ownMatch, conflict };
}

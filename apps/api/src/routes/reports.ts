import type { FastifyInstance } from "fastify";
import { sql as dsql } from "drizzle-orm";
import { db } from "@smart-crm/db";
import { authenticate } from "../auth/context.js";
import { requireManagerial } from "../auth/guards.js";
import { getHistoryFor, resolveRate } from "../services/commission.js";
import { REPORT_CATALOG, buildReport } from "../services/reports-data.js";
import { notFound } from "../lib/errors.js";

/** RFC-4180-ish CSV cell escaping. */
function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  return [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n");
}

/** USA date format mm/dd/yyyy. */
function usDate(d: string | Date): string {
  const x = new Date(d);
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${x.getFullYear()}`;
}

function parseRange(q: { from?: string; to?: string }) {
  const from = q.from ? new Date(q.from) : new Date("2000-01-01");
  // `to` is inclusive of the whole day.
  const to = q.to ? new Date(q.to) : new Date();
  to.setHours(23, 59, 59, 999);
  // postgres-js raw bind needs string params (not Date) — pass ISO + cast in SQL.
  return { from: from.toISOString(), to: to.toISOString() };
}

export async function registerReportRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // GET /api/reports/catalog — list of available manager reports.
  app.get("/catalog", async (req) => {
    requireManagerial(req);
    return { reports: REPORT_CATALOG };
  });

  // GET /api/reports/run/:key?from=&to= — structured report data (drives table + PDF/Excel).
  app.get("/run/:key", async (req) => {
    const viewer = requireManagerial(req);
    const { key } = req.params as { key: string };
    const { from, to } = parseRange(req.query as { from?: string; to?: string });
    const report = await buildReport(viewer.orgId, key, from, to);
    if (!report) throw notFound("Unknown report");
    report.generatedAt = new Date().toISOString();
    return { report };
  });

  // GET /api/reports/commission-statement/:advisorId?from=&to= — one advisor's statement.
  app.get("/commission-statement/:advisorId", async (req) => {
    const viewer = requireManagerial(req);
    const { advisorId } = req.params as { advisorId: string };
    const { from, to } = parseRange(req.query as { from?: string; to?: string });

    const [adv] = await db.execute<{ full_name: string; email: string }>(
      dsql`SELECT full_name, email FROM users WHERE id = ${advisorId}::uuid AND org_id = ${viewer.orgId}::uuid`,
    );
    if (!adv) throw notFound("Advisor not found");

    const rows = await db.execute<{ company: string; converted_at: string; deal_value: string; commission_rate_snapshot: string }>(dsql`
      SELECT o.contractor_company_name AS company, t.converted_at, t.deal_value, t.commission_rate_snapshot
      FROM transactions t
      JOIN opportunities o ON o.id = t.opportunity_id
      WHERE t.advisor_id = ${advisorId}::uuid AND t.org_id = ${viewer.orgId}::uuid
        AND t.converted_at >= ${from}::timestamptz AND t.converted_at <= ${to}::timestamptz
      ORDER BY t.converted_at ASC
    `);
    const history = await getHistoryFor([advisorId]);
    const data = rows.map((r) => {
      const dealValue = Number(r.deal_value);
      const rate = resolveRate(history.get(advisorId), new Date(r.converted_at)) ?? Number(r.commission_rate_snapshot);
      return { company: r.company, convertedAt: r.converted_at, dealValue, rate, commission: Math.round(((dealValue * rate) / 100) * 100) / 100 };
    });
    return {
      advisorName: adv.full_name,
      advisorEmail: adv.email,
      from,
      to,
      rows: data,
      totals: {
        deals: data.length,
        dealValue: data.reduce((s, r) => s + r.dealValue, 0),
        commission: data.reduce((s, r) => s + r.commission, 0),
      },
    };
  });

  // GET /api/reports/converted?from=&to=&format=csv — the core money report (§14). Managerial only.
  app.get("/converted", async (req, reply) => {
    const viewer = requireManagerial(req);
    const q = req.query as { from?: string; to?: string; format?: string };
    const { from, to } = parseRange(q);

    const rows = await db.execute<{
      company: string;
      advisor_id: string;
      advisor_name: string;
      converted_at: string;
      deal_value: string;
      commission_rate_snapshot: string;
      commission_amount: string;
    }>(dsql`
      SELECT o.contractor_company_name AS company,
             t.advisor_id,
             u.full_name              AS advisor_name,
             t.converted_at,
             t.deal_value,
             t.commission_rate_snapshot,
             t.commission_amount
      FROM transactions t
      JOIN opportunities o ON o.id = t.opportunity_id
      JOIN users u ON u.id = t.advisor_id
      WHERE t.org_id = ${viewer.orgId}::uuid AND t.converted_at >= ${from}::timestamptz AND t.converted_at <= ${to}::timestamptz
      ORDER BY t.converted_at DESC
    `);

    // Resolve each transaction's rate from the commission history effective on its
    // conversion date (§10). Falls back to the stored snapshot if no history exists.
    const history = await getHistoryFor([...new Set(rows.map((r) => r.advisor_id))]);
    const data = rows.map((r) => {
      const convertedAt = new Date(r.converted_at);
      const dealValue = Number(r.deal_value);
      const effective = resolveRate(history.get(r.advisor_id), convertedAt);
      const rate = effective ?? Number(r.commission_rate_snapshot);
      const amount = Math.round(((dealValue * rate) / 100) * 100) / 100;
      return {
        company: r.company,
        advisorName: r.advisor_name,
        convertedAt: r.converted_at,
        dealValue,
        commissionRateSnapshot: rate,
        commissionAmount: amount,
      };
    });

    if (q.format === "csv") {
      const csv = toCsv(
        ["Company", "Advisor", "Converted Date", "Deal Value", "Commission Rate %", "Commission Amount"],
        data.map((r) => [r.company, r.advisorName, usDate(r.convertedAt), r.dealValue, r.commissionRateSnapshot, r.commissionAmount]),
      );
      reply.header("Content-Type", "text/csv; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename="converted-customers.csv"`);
      return reply.send(csv);
    }

    return {
      rows: data,
      totals: {
        count: data.length,
        dealValue: data.reduce((s, r) => s + r.dealValue, 0),
        commissionAmount: data.reduce((s, r) => s + r.commissionAmount, 0),
      },
    };
  });

  // GET /api/reports/pipeline — open opportunities by status with value totals (§14).
  app.get("/pipeline", async (req) => {
    const viewer = requireManagerial(req);
    const rows = await db.execute<{
      status: string;
      label: string;
      count: number;
      value: string;
    }>(dsql`
      SELECT o.status,
             s.label,
             count(o.id) AS count,
             COALESCE(sum(o.opportunity_value), 0) AS value
      FROM opportunities o
      JOIN status_stages s ON s.org_id = o.org_id AND s.key = o.status
      WHERE s.is_terminal = false AND o.org_id = ${viewer.orgId}::uuid
      GROUP BY o.status, s.label, s.sort_order
      ORDER BY s.sort_order
    `);
    return {
      byStatus: rows.map((r) => ({
        status: r.status,
        label: r.label,
        count: Number(r.count),
        value: Number(r.value),
      })),
    };
  });
}

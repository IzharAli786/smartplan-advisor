import type { FastifyInstance } from "fastify";
import { sql as dsql } from "drizzle-orm";
import { db } from "@smart-crm/db";
import { authenticate } from "../auth/context.js";
import { requireManagerial } from "../auth/guards.js";

/** Manager roll-ups (§12). Managerial only. */
export async function registerDashboardRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // GET /api/dashboard/by-advisor?state=CO
  app.get("/by-advisor", async (req) => {
    const viewer = requireManagerial(req);
    const state = (req.query as { state?: string }).state?.toUpperCase();
    const stateFilter = state ? dsql`AND o.state = ${state}` : dsql``;

    const rows = await db.execute<{
      id: string;
      full_name: string;
      email: string;
      phone: string | null;
      states_covered: string[];
      total_opps: number;
      open_opps: number;
      open_value: string;
      won_count: number;
    }>(dsql`
      SELECT u.id, u.full_name, u.email, u.phone, u.states_covered,
             count(o.id)                                              AS total_opps,
             count(o.id) FILTER (WHERE s.is_terminal = false)         AS open_opps,
             COALESCE(sum(o.opportunity_value) FILTER (WHERE s.is_terminal = false), 0) AS open_value,
             count(o.id) FILTER (WHERE s.is_conversion = true)        AS won_count
      FROM users u
      LEFT JOIN opportunities o ON o.advisor_id = u.id ${stateFilter}
      LEFT JOIN status_stages s ON s.org_id = o.org_id AND s.key = o.status
      WHERE u.role = 'advisor' AND u.org_id = ${viewer.orgId}
      GROUP BY u.id, u.full_name, u.email, u.phone, u.states_covered
      ORDER BY open_value DESC
    `);

    return {
      advisors: rows.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        email: r.email,
        phone: r.phone,
        statesCovered: r.states_covered ?? [],
        totalOpps: Number(r.total_opps),
        openOpps: Number(r.open_opps),
        openValue: Number(r.open_value),
        wonCount: Number(r.won_count),
        conversionRate: Number(r.total_opps) > 0 ? Number(r.won_count) / Number(r.total_opps) : 0,
      })),
    };
  });

  // GET /api/dashboard/by-state
  app.get("/by-state", async (req) => {
    const viewer = requireManagerial(req);
    const rows = await db.execute<{
      state: string;
      total_opps: number;
      open_opps: number;
      open_value: string;
      won_count: number;
    }>(dsql`
      SELECT o.state,
             count(o.id)                                       AS total_opps,
             count(o.id) FILTER (WHERE s.is_terminal = false)  AS open_opps,
             COALESCE(sum(o.opportunity_value) FILTER (WHERE s.is_terminal = false), 0) AS open_value,
             count(o.id) FILTER (WHERE s.is_conversion = true) AS won_count
      FROM opportunities o
      JOIN status_stages s ON s.org_id = o.org_id AND s.key = o.status
      WHERE o.org_id = ${viewer.orgId}
      GROUP BY o.state
      ORDER BY open_value DESC
    `);

    return {
      states: rows.map((r) => ({
        state: r.state,
        totalOpps: Number(r.total_opps),
        openOpps: Number(r.open_opps),
        openValue: Number(r.open_value),
        wonCount: Number(r.won_count),
      })),
    };
  });

  // GET /api/dashboard/analytics — trend + comparison data that drives the dashboard charts.
  app.get("/analytics", async (req) => {
    const viewer = requireManagerial(req);
    const org = viewer.orgId;

    const won = await db.execute<{ ym: string; cnt: number; val: string }>(dsql`
      SELECT to_char(date_trunc('month', converted_at), 'YYYY-MM') AS ym, count(*)::int AS cnt, COALESCE(sum(deal_value), 0) AS val
      FROM transactions
      WHERE org_id = ${org} AND converted_at >= date_trunc('month', now()) - interval '11 months'
      GROUP BY 1`);
    const created = await db.execute<{ ym: string; cnt: number }>(dsql`
      SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS ym, count(*)::int AS cnt
      FROM opportunities
      WHERE org_id = ${org} AND created_at >= date_trunc('month', now()) - interval '11 months'
      GROUP BY 1`);
    const stage = await db.execute<{ label: string; cnt: number; val: string }>(dsql`
      SELECT s.label, count(o.id)::int AS cnt, COALESCE(sum(o.opportunity_value), 0) AS val
      FROM opportunities o JOIN status_stages s ON s.org_id = o.org_id AND s.key = o.status
      WHERE o.org_id = ${org} AND s.is_terminal = false
      GROUP BY s.label, s.sort_order ORDER BY s.sort_order`);
    const prod = await db.execute<{ product: string; val: string }>(dsql`
      SELECT COALESCE(NULLIF(o.product, ''), '—') AS product, COALESCE(sum(t.deal_value), 0) AS val
      FROM transactions t JOIN opportunities o ON o.id = t.opportunity_id
      WHERE t.org_id = ${org} AND t.converted_at >= date_trunc('year', now())
      GROUP BY 1 ORDER BY val DESC LIMIT 8`);

    const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const now = new Date();
    const wonMap = new Map(won.map((r) => [r.ym, { cnt: Number(r.cnt), val: Number(r.val) }]));
    const createdMap = new Map(created.map((r) => [r.ym, Number(r.cnt)]));
    const monthly = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      monthly.push({
        ym,
        label: MON[d.getUTCMonth()]!,
        wonValue: wonMap.get(ym)?.val ?? 0,
        wonCount: wonMap.get(ym)?.cnt ?? 0,
        newCount: createdMap.get(ym) ?? 0,
      });
    }

    return {
      monthly,
      pipeline: stage.map((s) => ({ label: s.label, count: Number(s.cnt), value: Number(s.val) })),
      products: prod.map((p) => ({ product: p.product, value: Number(p.val) })),
    };
  });
}

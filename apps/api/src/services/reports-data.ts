import { sql as dsql } from "drizzle-orm";
import { db } from "@smart-crm/db";
import { getHistoryFor, resolveRate } from "./commission.js";

/** Structured report shape — the same JSON drives on-screen tables and PDF/Excel export. */
export type ColType = "text" | "number" | "currency" | "percent" | "date";
export interface ReportColumn {
  key: string;
  label: string;
  type?: ColType;
}
export interface ReportData {
  key: string;
  title: string;
  subtitle?: string;
  dateRange: boolean;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
  generatedAt: string;
}

export interface ReportMeta {
  key: string;
  title: string;
  description: string;
  dateRange: boolean;
}

export const REPORT_CATALOG: ReportMeta[] = [
  { key: "converted", title: "Converted Customers", description: "Every won deal with its effective commission.", dateRange: true },
  { key: "advisor-performance", title: "Advisor Performance", description: "Leaderboard: pipeline, wins, conversion and commission per advisor.", dateRange: true },
  { key: "commission-by-advisor", title: "Commission Summary", description: "Total commission owed per advisor for the period.", dateRange: true },
  { key: "sales-by-state", title: "Sales by State", description: "Pipeline and won business by territory.", dateRange: true },
  { key: "sales-by-product", title: "Sales by Product", description: "Which SmartPlan products are selling.", dateRange: true },
  { key: "pipeline-by-stage", title: "Pipeline by Stage", description: "Open opportunities and value at each stage.", dateRange: false },
  { key: "forecast", title: "Forecast & Quota", description: "This month's quota attainment plus a probability-weighted pipeline forecast.", dateRange: false },
  { key: "smartplan-transactions", title: "Smart Plan Transactions", description: "Every Smart Plan (Stripe/manual) transaction per advisor — click an advisor to open their history.", dateRange: true },
];

const round2 = (n: number) => Math.round(n * 100) / 100;

interface EnrichedTx {
  advisorId: string;
  advisorName: string;
  company: string;
  state: string;
  product: string | null;
  convertedAt: string;
  dealValue: number;
  rate: number;
  commission: number;
}

/** Transactions in a date range, each carrying the rate EFFECTIVE on its conversion date (§10). */
async function getTransactions(orgId: string, from: string, to: string): Promise<EnrichedTx[]> {
  const rows = await db.execute<{
    advisor_id: string;
    advisor_name: string;
    company: string;
    state: string;
    product: string | null;
    converted_at: string;
    deal_value: string;
    commission_rate_snapshot: string;
  }>(dsql`
    SELECT t.advisor_id, u.full_name AS advisor_name, o.contractor_company_name AS company,
           o.state, o.product, t.converted_at, t.deal_value, t.commission_rate_snapshot
    FROM transactions t
    JOIN opportunities o ON o.id = t.opportunity_id
    JOIN users u ON u.id = t.advisor_id
    WHERE t.org_id = ${orgId}
      AND t.converted_at >= ${from}::timestamptz AND t.converted_at <= ${to}::timestamptz
    ORDER BY t.converted_at DESC
  `);
  const history = await getHistoryFor([...new Set(rows.map((r) => r.advisor_id))]);
  return rows.map((r) => {
    const convertedAt = new Date(r.converted_at);
    const dealValue = Number(r.deal_value);
    const rate = resolveRate(history.get(r.advisor_id), convertedAt) ?? Number(r.commission_rate_snapshot);
    return {
      advisorId: r.advisor_id,
      advisorName: r.advisor_name,
      company: r.company,
      state: r.state,
      product: r.product,
      convertedAt: r.converted_at,
      dealValue,
      rate,
      commission: round2((dealValue * rate) / 100),
    };
  });
}

// ── Report builders ──────────────────────────────────────────

async function converted(orgId: string, from: string, to: string): Promise<ReportData> {
  const txs = await getTransactions(orgId, from, to);
  return {
    key: "converted",
    title: "Converted Customers",
    subtitle: "Won deals with effective commission",
    dateRange: true,
    columns: [
      { key: "company", label: "Company", type: "text" },
      { key: "advisorName", label: "Advisor", type: "text" },
      { key: "convertedAt", label: "Converted", type: "date" },
      { key: "dealValue", label: "Deal Value", type: "currency" },
      { key: "rate", label: "Rate %", type: "percent" },
      { key: "commission", label: "Commission", type: "currency" },
    ],
    rows: txs.map((t) => ({ ...t })),
    totals: {
      company: `${txs.length} deals`,
      dealValue: round2(txs.reduce((s, t) => s + t.dealValue, 0)),
      commission: round2(txs.reduce((s, t) => s + t.commission, 0)),
    },
    generatedAt: "",
  };
}

async function advisorPerformance(orgId: string, from: string, to: string): Promise<ReportData> {
  // Current open pipeline + all-time conversion per advisor.
  const agg = await db.execute<{
    id: string;
    full_name: string;
    states_covered: string[];
    total: number;
    open_opps: number;
    open_value: string;
    won_all: number;
  }>(dsql`
    SELECT u.id, u.full_name, u.states_covered,
           count(o.id) AS total,
           count(o.id) FILTER (WHERE s.is_terminal = false) AS open_opps,
           COALESCE(sum(o.opportunity_value) FILTER (WHERE s.is_terminal = false), 0) AS open_value,
           count(o.id) FILTER (WHERE s.is_conversion = true) AS won_all
    FROM users u
    LEFT JOIN opportunities o ON o.advisor_id = u.id
    LEFT JOIN status_stages s ON s.org_id = o.org_id AND s.key = o.status
    WHERE u.role = 'advisor' AND u.active = true AND u.org_id = ${orgId}
    GROUP BY u.id, u.full_name, u.states_covered
  `);
  const txs = await getTransactions(orgId, from, to);
  const byAdvisor = new Map<string, { deals: number; value: number; commission: number }>();
  for (const t of txs) {
    const a = byAdvisor.get(t.advisorId) ?? { deals: 0, value: 0, commission: 0 };
    a.deals++;
    a.value += t.dealValue;
    a.commission += t.commission;
    byAdvisor.set(t.advisorId, a);
  }
  const rows = agg
    .map((r) => {
      const won = byAdvisor.get(r.id) ?? { deals: 0, value: 0, commission: 0 };
      const total = Number(r.total);
      return {
        advisorName: r.full_name,
        states: (r.states_covered ?? []).join(", "),
        openOpps: Number(r.open_opps),
        openValue: Number(r.open_value),
        wonDeals: won.deals,
        wonValue: round2(won.value),
        commission: round2(won.commission),
        conversion: total > 0 ? Math.round((Number(r.won_all) / total) * 100) : 0,
      };
    })
    .sort((a, b) => b.commission - a.commission);
  return {
    key: "advisor-performance",
    title: "Advisor Performance",
    subtitle: "Leaderboard for the selected period",
    dateRange: true,
    columns: [
      { key: "advisorName", label: "Advisor", type: "text" },
      { key: "states", label: "States", type: "text" },
      { key: "openOpps", label: "Open", type: "number" },
      { key: "openValue", label: "Open Value", type: "currency" },
      { key: "wonDeals", label: "Won", type: "number" },
      { key: "wonValue", label: "Won Value", type: "currency" },
      { key: "commission", label: "Commission", type: "currency" },
      { key: "conversion", label: "Conv. %", type: "percent" },
    ],
    rows,
    totals: {
      advisorName: `${rows.length} advisors`,
      openValue: round2(rows.reduce((s, r) => s + r.openValue, 0)),
      wonValue: round2(rows.reduce((s, r) => s + r.wonValue, 0)),
      commission: round2(rows.reduce((s, r) => s + r.commission, 0)),
    },
    generatedAt: "",
  };
}

async function commissionByAdvisor(orgId: string, from: string, to: string): Promise<ReportData> {
  const txs = await getTransactions(orgId, from, to);
  const byAdvisor = new Map<string, { advisorName: string; deals: number; dealValue: number; commission: number }>();
  for (const t of txs) {
    const a = byAdvisor.get(t.advisorId) ?? { advisorName: t.advisorName, deals: 0, dealValue: 0, commission: 0 };
    a.deals++;
    a.dealValue += t.dealValue;
    a.commission += t.commission;
    byAdvisor.set(t.advisorId, a);
  }
  const rows = [...byAdvisor.values()]
    .map((a) => ({ advisorName: a.advisorName, deals: a.deals, dealValue: round2(a.dealValue), commission: round2(a.commission) }))
    .sort((a, b) => b.commission - a.commission);
  return {
    key: "commission-by-advisor",
    title: "Commission Summary",
    subtitle: "Commission owed per advisor for the period",
    dateRange: true,
    columns: [
      { key: "advisorName", label: "Advisor", type: "text" },
      { key: "deals", label: "Deals Won", type: "number" },
      { key: "dealValue", label: "Deal Value", type: "currency" },
      { key: "commission", label: "Commission", type: "currency" },
    ],
    rows,
    totals: {
      advisorName: `${rows.length} advisors`,
      deals: rows.reduce((s, r) => s + r.deals, 0),
      dealValue: round2(rows.reduce((s, r) => s + r.dealValue, 0)),
      commission: round2(rows.reduce((s, r) => s + r.commission, 0)),
    },
    generatedAt: "",
  };
}

async function salesByKey(orgId: string, from: string, to: string, key: "state" | "product"): Promise<ReportData> {
  const col = key === "state" ? dsql`o.state` : dsql`COALESCE(o.product, '—')`;
  const open = await db.execute<{ k: string; open_opps: number; open_value: string }>(dsql`
    SELECT ${col} AS k,
           count(o.id) FILTER (WHERE s.is_terminal = false) AS open_opps,
           COALESCE(sum(o.opportunity_value) FILTER (WHERE s.is_terminal = false), 0) AS open_value
    FROM opportunities o JOIN status_stages s ON s.org_id = o.org_id AND s.key = o.status
    WHERE o.org_id = ${orgId}
    GROUP BY ${col}
  `);
  const txs = await getTransactions(orgId, from, to);
  const wonMap = new Map<string, { deals: number; value: number }>();
  for (const t of txs) {
    const k = (key === "state" ? t.state : t.product) ?? "—";
    const w = wonMap.get(k) ?? { deals: 0, value: 0 };
    w.deals++;
    w.value += t.dealValue;
    wonMap.set(k, w);
  }
  const keys = new Set<string>([...open.map((o) => o.k), ...wonMap.keys()]);
  const openMap = new Map(open.map((o) => [o.k, o]));
  const rows = [...keys]
    .map((k) => {
      const o = openMap.get(k);
      const w = wonMap.get(k) ?? { deals: 0, value: 0 };
      return {
        group: k,
        openOpps: o ? Number(o.open_opps) : 0,
        openValue: o ? Number(o.open_value) : 0,
        wonDeals: w.deals,
        wonValue: round2(w.value),
      };
    })
    .sort((a, b) => b.openValue + b.wonValue - (a.openValue + a.wonValue));
  return {
    key: key === "state" ? "sales-by-state" : "sales-by-product",
    title: key === "state" ? "Sales by State" : "Sales by Product",
    subtitle: key === "state" ? "Pipeline and won business by territory" : "Pipeline and won business by product",
    dateRange: true,
    columns: [
      { key: "group", label: key === "state" ? "State" : "Product", type: "text" },
      { key: "openOpps", label: "Open", type: "number" },
      { key: "openValue", label: "Open Value", type: "currency" },
      { key: "wonDeals", label: "Won", type: "number" },
      { key: "wonValue", label: "Won Value", type: "currency" },
    ],
    rows,
    totals: {
      group: `${rows.length} ${key === "state" ? "states" : "products"}`,
      openValue: round2(rows.reduce((s, r) => s + r.openValue, 0)),
      wonValue: round2(rows.reduce((s, r) => s + r.wonValue, 0)),
    },
    generatedAt: "",
  };
}

async function pipelineByStage(orgId: string): Promise<ReportData> {
  const rows = await db.execute<{ status: string; label: string; count: number; value: string }>(dsql`
    SELECT o.status, s.label, count(o.id) AS count, COALESCE(sum(o.opportunity_value), 0) AS value
    FROM opportunities o JOIN status_stages s ON s.org_id = o.org_id AND s.key = o.status
    WHERE s.is_terminal = false AND o.org_id = ${orgId}
    GROUP BY o.status, s.label, s.sort_order
    ORDER BY s.sort_order
  `);
  const data = rows.map((r) => ({ stage: r.label, count: Number(r.count), value: Number(r.value) }));
  return {
    key: "pipeline-by-stage",
    title: "Pipeline by Stage",
    subtitle: "Open opportunities and value at each stage",
    dateRange: false,
    columns: [
      { key: "stage", label: "Stage", type: "text" },
      { key: "count", label: "Opportunities", type: "number" },
      { key: "value", label: "Value", type: "currency" },
    ],
    rows: data,
    totals: { stage: "Total", count: data.reduce((s, r) => s + r.count, 0), value: round2(data.reduce((s, r) => s + r.value, 0)) },
    generatedAt: "",
  };
}

async function forecast(orgId: string): Promise<ReportData> {
  // Current-month window for quota attainment.
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthEnd = now.toISOString();

  // Open pipeline + probability-weighted forecast per advisor (current snapshot).
  const pipe = await db.execute<{ id: string; full_name: string; quota: string | null; open_value: string; weighted: string; committed: string }>(dsql`
    SELECT u.id, u.full_name, u.monthly_quota AS quota,
           COALESCE(sum(o.opportunity_value) FILTER (WHERE s.is_terminal = false), 0) AS open_value,
           COALESCE(sum(o.opportunity_value * s.win_probability / 100.0) FILTER (WHERE s.is_terminal = false), 0) AS weighted,
           COALESCE(sum(o.opportunity_value) FILTER (WHERE s.is_terminal = false AND s.win_probability >= 70), 0) AS committed
    FROM users u
    LEFT JOIN opportunities o ON o.advisor_id = u.id
    LEFT JOIN status_stages s ON s.org_id = o.org_id AND s.key = o.status
    WHERE u.role = 'advisor' AND u.active = true AND u.org_id = ${orgId}
    GROUP BY u.id, u.full_name, u.monthly_quota
  `);

  // Won this month (effective-dated) per advisor.
  const txs = await getTransactions(orgId, monthStart, monthEnd);
  const wonByAdvisor = new Map<string, number>();
  for (const t of txs) wonByAdvisor.set(t.advisorId, (wonByAdvisor.get(t.advisorId) ?? 0) + t.dealValue);

  const rows = pipe
    .map((r) => {
      const quota = r.quota != null ? Number(r.quota) : 0;
      const wonMonth = round2(wonByAdvisor.get(r.id) ?? 0);
      return {
        advisorName: r.full_name,
        quota,
        wonMonth,
        attainment: quota > 0 ? Math.round((wonMonth / quota) * 100) : 0,
        openValue: round2(Number(r.open_value)),
        weighted: round2(Number(r.weighted)),
        committed: round2(Number(r.committed)),
      };
    })
    .sort((a, b) => b.weighted - a.weighted);

  return {
    key: "forecast",
    title: "Forecast & Quota",
    subtitle: `This month's attainment and weighted pipeline (as of ${new Date().toISOString().slice(0, 10)})`,
    dateRange: false,
    columns: [
      { key: "advisorName", label: "Advisor", type: "text" },
      { key: "quota", label: "Monthly Quota", type: "currency" },
      { key: "wonMonth", label: "Won (MTD)", type: "currency" },
      { key: "attainment", label: "Attainment", type: "percent" },
      { key: "openValue", label: "Open Pipeline", type: "currency" },
      { key: "weighted", label: "Weighted Forecast", type: "currency" },
      { key: "committed", label: "Best Case", type: "currency" },
    ],
    rows,
    totals: {
      advisorName: `${rows.length} advisors`,
      quota: round2(rows.reduce((s, r) => s + r.quota, 0)),
      wonMonth: round2(rows.reduce((s, r) => s + r.wonMonth, 0)),
      openValue: round2(rows.reduce((s, r) => s + r.openValue, 0)),
      weighted: round2(rows.reduce((s, r) => s + r.weighted, 0)),
      committed: round2(rows.reduce((s, r) => s + r.committed, 0)),
    },
    generatedAt: "",
  };
}

async function smartplanTransactionsReport(orgId: string, from: string, to: string): Promise<ReportData> {
  const rows = await db.execute<{
    advisor_id: string;
    advisor_name: string;
    occurred_at: string;
    stripe_transaction_id: string | null;
    amount: string;
    product: string | null;
    status: string;
  }>(dsql`
    SELECT t.advisor_id, u.full_name AS advisor_name, t.occurred_at, t.stripe_transaction_id, t.amount, t.product, t.status
    FROM smartplan_transactions t
    JOIN users u ON u.id = t.advisor_id
    WHERE t.org_id = ${orgId} AND t.occurred_at >= ${from}::timestamptz AND t.occurred_at <= ${to}::timestamptz
    ORDER BY t.occurred_at DESC
  `);
  // Resolve each transaction's commission from the rate EFFECTIVE on its transaction date.
  const history = await getHistoryFor([...new Set(rows.map((r) => r.advisor_id))]);
  const data = rows.map((r) => {
    const amount = round2(Number(r.amount));
    const rate = resolveRate(history.get(r.advisor_id), new Date(r.occurred_at)) ?? 0;
    return {
      advisorId: r.advisor_id,
      advisorName: r.advisor_name,
      occurredAt: r.occurred_at,
      stripeId: r.stripe_transaction_id ?? "—",
      product: r.product ?? "—",
      amount,
      rate,
      commission: round2((amount * rate) / 100),
      status: r.status,
    };
  });
  return {
    key: "smartplan-transactions",
    title: "Smart Plan Transactions",
    subtitle: "All Smart Plan transactions by advisor, with commission at the rate effective on each transaction date",
    dateRange: true,
    columns: [
      { key: "advisorName", label: "Advisor", type: "text" },
      { key: "occurredAt", label: "Date", type: "date" },
      { key: "stripeId", label: "Stripe #", type: "text" },
      { key: "product", label: "Product", type: "text" },
      { key: "amount", label: "Amount", type: "currency" },
      { key: "rate", label: "Rate %", type: "percent" },
      { key: "commission", label: "Commission", type: "currency" },
      { key: "status", label: "Status", type: "text" },
    ],
    rows: data,
    totals: {
      advisorName: `${data.length} transactions`,
      amount: round2(data.reduce((s, r) => s + r.amount, 0)),
      commission: round2(data.reduce((s, r) => s + r.commission, 0)),
    },
    generatedAt: "",
  };
}

export async function buildReport(orgId: string, key: string, from: string, to: string): Promise<ReportData | null> {
  switch (key) {
    case "converted":
      return converted(orgId, from, to);
    case "advisor-performance":
      return advisorPerformance(orgId, from, to);
    case "commission-by-advisor":
      return commissionByAdvisor(orgId, from, to);
    case "sales-by-state":
      return salesByKey(orgId, from, to, "state");
    case "sales-by-product":
      return salesByKey(orgId, from, to, "product");
    case "pipeline-by-stage":
      return pipelineByStage(orgId);
    case "forecast":
      return forecast(orgId);
    case "smartplan-transactions":
      return smartplanTransactionsReport(orgId, from, to);
    default:
      return null;
  }
}

/** Lightweight inline-SVG charts — no external chart library (keeps the CSP self-contained). */

import { money, moneyCompact as compact } from "../lib/format.ts";

export const CHART_COLORS = ["#00c2cf", "#14b8a6", "#f5b301", "#8b5cf6", "#ef6f6c", "#22c55e", "#f97316", "#0ea5e9"];

/** Vertical bar chart for a time series (e.g. monthly revenue). Last bar is highlighted. */
export function BarChart({ data, highlightLast = true, format = "currency" }: { data: { label: string; value: number; sub?: string }[]; highlightLast?: boolean; format?: "currency" | "number" }) {
  const W = 640;
  const H = 200;
  const padB = 24;
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = data.length;
  const bw = (W / n) * 0.62;
  const gap = W / n;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ display: "block" }}>
      {[0.25, 0.5, 0.75, 1].map((t) => (
        <line key={t} x1={0} x2={W} y1={(H - padB) * (1 - t)} y2={(H - padB) * (1 - t)} stroke="var(--color-border)" strokeWidth="1" strokeDasharray="2 4" />
      ))}
      {data.map((d, i) => {
        const h = ((H - padB) * d.value) / max;
        const x = i * gap + (gap - bw) / 2;
        const y = H - padB - h;
        const isLast = highlightLast && i === n - 1;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={Math.max(0, h)} rx="3" fill={isLast ? "#00d9d9" : "#0f9fb0"} opacity={d.value === 0 ? 0.25 : 1}>
              <title>{`${d.label}: ${format === "currency" ? money(d.value) : d.value}${d.sub ? ` · ${d.sub}` : ""}`}</title>
            </rect>
            {d.value > 0 && (
              <text x={x + bw / 2} y={y - 4} textAnchor="middle" fontSize="9" fill="var(--color-text-muted)">
                {format === "currency" ? compact(d.value) : d.value}
              </text>
            )}
            <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--color-text-muted)">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Horizontal bars (e.g. pipeline value by stage). */
export function HBars({ data, format = "currency" }: { data: { label: string; value: number; sub?: string }[]; format?: "currency" | "number" }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (data.length === 0) return <div className="muted" style={{ fontSize: ".85rem" }}>No data.</div>;
  return (
    <div className="stack" style={{ gap: ".55rem" }}>
      {data.map((d, i) => (
        <div key={i}>
          <div className="row" style={{ fontSize: ".8rem" }}>
            <span>{d.label}</span>
            <span className="muted">{d.sub ?? (format === "currency" ? money(d.value) : d.value)}</span>
          </div>
          <div style={{ height: 10, borderRadius: 5, background: "var(--color-surface-2)", overflow: "hidden", marginTop: 3 }}>
            <div style={{ width: `${(d.value / max) * 100}%`, height: "100%", borderRadius: 5, background: CHART_COLORS[i % CHART_COLORS.length] }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Donut chart with legend (e.g. won value by product). */
export function Donut({ data }: { data: { label: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const R = 60;
  const r = 38;
  const C = 80;
  if (total <= 0) return <div className="muted" style={{ fontSize: ".85rem" }}>No won revenue yet this year.</div>;
  let acc = 0;
  const segs = data.map((d, i) => {
    const frac = d.value / total;
    const a0 = acc * 2 * Math.PI - Math.PI / 2;
    acc += frac;
    const a1 = acc * 2 * Math.PI - Math.PI / 2;
    const large = frac > 0.5 ? 1 : 0;
    const p = (ang: number, rad: number) => `${C + rad * Math.cos(ang)} ${C + rad * Math.sin(ang)}`;
    const path = `M ${p(a0, R)} A ${R} ${R} 0 ${large} 1 ${p(a1, R)} L ${p(a1, r)} A ${r} ${r} 0 ${large} 0 ${p(a0, r)} Z`;
    return { path, color: CHART_COLORS[i % CHART_COLORS.length], d };
  });
  return (
    <div className="row" style={{ justifyContent: "flex-start", gap: "1.25rem", flexWrap: "wrap" }}>
      <svg viewBox="0 0 160 160" width="150" height="150" role="img">
        {segs.map((s, i) => (
          <path key={i} d={s.path} fill={s.color}>
            <title>{`${s.d.label}: ${money(s.d.value)} (${Math.round((s.d.value / total) * 100)}%)`}</title>
          </path>
        ))}
        <text x="80" y="76" textAnchor="middle" fontSize="11" fill="var(--color-text-muted)">Total</text>
        <text x="80" y="92" textAnchor="middle" fontSize="14" fontWeight="700" fill="var(--color-text)">{compact(total)}</text>
      </svg>
      <div className="stack" style={{ gap: ".3rem" }}>
        {segs.map((s, i) => (
          <div key={i} className="row" style={{ justifyContent: "flex-start", gap: ".4rem", fontSize: ".8rem" }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flex: "0 0 auto" }} />
            <span style={{ flex: 1 }}>{s.d.label}</span>
            <span className="muted">{compact(s.d.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

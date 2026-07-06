/**
 * USA opportunity heatmap — a state tile-grid map (each state a cell in an approximate
 * geographic layout), coloured by how many opportunities sit in that state. Self-contained
 * (no external map data or libraries).
 */

import { money } from "../lib/format.ts";

// [row, col] on an 8-row × 11-col grid, laid out roughly like the US.
const GRID: Record<string, [number, number]> = {
  AK: [0, 0], ME: [0, 10],
  VT: [1, 9], NH: [1, 10],
  WA: [2, 1], ID: [2, 2], MT: [2, 3], ND: [2, 4], MN: [2, 5], WI: [2, 6], MI: [2, 7], NY: [2, 8], MA: [2, 9], RI: [2, 10],
  OR: [3, 1], NV: [3, 2], WY: [3, 3], SD: [3, 4], IA: [3, 5], IL: [3, 6], IN: [3, 7], OH: [3, 8], PA: [3, 9], CT: [3, 10],
  CA: [4, 1], UT: [4, 2], CO: [4, 3], NE: [4, 4], MO: [4, 5], KY: [4, 6], WV: [4, 7], VA: [4, 8], NJ: [4, 9], MD: [4, 10],
  AZ: [5, 2], NM: [5, 3], KS: [5, 4], AR: [5, 5], TN: [5, 6], NC: [5, 7], SC: [5, 8], DE: [5, 9], DC: [5, 10],
  OK: [6, 4], LA: [6, 5], MS: [6, 6], AL: [6, 7], GA: [6, 8],
  HI: [7, 0], TX: [7, 4], FL: [7, 8],
};

function cellStyle(count: number, max: number): React.CSSProperties {
  if (!count) return { background: "var(--color-surface-2)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" };
  const t = 0.22 + 0.78 * (max > 0 ? count / max : 0);
  return { background: `rgba(0,201,201,${t})`, color: t > 0.55 ? "#fff" : "var(--color-text)", border: "1px solid transparent" };
}

export default function USStateHeatmap({
  counts,
  values,
  selected,
  onSelect,
}: {
  counts: Record<string, number>;
  values?: Record<string, number>;
  selected?: string | null;
  onSelect?: (code: string) => void;
}) {
  const max = Math.max(1, ...Object.values(counts));

  return (
    <div>
      <div className="us-heatmap">
        {Object.entries(GRID).map(([code, [row, col]]) => {
          const count = counts[code] ?? 0;
          const clickable = count > 0 && !!onSelect;
          const isSelected = selected === code;
          const title = count
            ? `${code}: ${count} opportunit${count === 1 ? "y" : "ies"}${values?.[code] ? ` · ${money(values[code]!)}` : ""}${clickable ? " — click to filter" : ""}`
            : `${code}: none`;
          return (
            <div
              key={code}
              className={`us-cell${clickable ? " clickable" : ""}${isSelected ? " selected" : ""}`}
              style={{ gridColumn: col + 1, gridRow: row + 1, ...cellStyle(count, max) }}
              title={title}
              onClick={clickable ? () => onSelect!(code) : undefined}
              role={clickable ? "button" : undefined}
              aria-pressed={clickable ? isSelected : undefined}
            >
              <span className="us-cell-code">{code}</span>
              {count > 0 && <span className="us-cell-count">{count}</span>}
            </div>
          );
        })}
      </div>
      {/* Legend */}
      <div className="row" style={{ justifyContent: "flex-start", gap: ".5rem", marginTop: ".75rem", fontSize: ".72rem" }}>
        <span className="muted">Fewer</span>
        <span style={{ display: "inline-flex", gap: 2 }}>
          {[0.22, 0.45, 0.68, 0.9, 1].map((t) => (
            <span key={t} style={{ width: 18, height: 12, borderRadius: 2, background: `rgba(0,201,201,${t})` }} />
          ))}
        </span>
        <span className="muted">More opportunities</span>
      </div>
    </div>
  );
}

import { Icon } from "./Icon.tsx";
import type { Badge } from "../api/types.ts";

/** Ego badge pill (Bronze…Diamond) coloured by the tier. */
export function BadgeChip({ badge, sub }: { badge: Badge | null; sub?: string }) {
  if (!badge) return <span className="muted" style={{ fontSize: ".82rem" }}>No badge yet</span>;
  const color = badge.color ?? "#00c2cf";
  return (
    <span
      className="badge-chip"
      style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}
      title={`Reached ${badge.minPercent}% of objective`}
    >
      <Icon name="trophy" size={14} />
      {badge.label}
      {sub ? <span style={{ opacity: 0.75, fontWeight: 500 }}> · {sub}</span> : null}
    </span>
  );
}

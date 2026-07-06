import type { CSSProperties } from "react";

/**
 * The SmartPlan brand mark: a bold right arrow. Uses `currentColor`, so it reads charcoal
 * on light backgrounds and white on dark — set the colour via the surrounding text colour
 * (e.g. var(--color-text)) or an explicit `color`.
 */
export function BrandMark({ size = 28, style, title = "SmartPlan" }: { size?: number; style?: CSSProperties; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      stroke="currentColor"
      strokeWidth={54}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={title}
      style={style}
    >
      <path d="M92 256 H372" />
      <path d="M300 148 L408 256 L300 364" />
    </svg>
  );
}

/**
 * Advise wordmark — bold "Advise" with a bright teal dot. Text uses `currentColor` so it
 * renders dark on the light auth cards and white in the navy sidebar; the dot is the brand
 * teal. This is the platform default logo (an org can still upload its own in Settings).
 */
export function AdviseWordmark({ size = 40 }: { size?: number }) {
  return (
    <span
      style={{
        fontSize: size,
        fontWeight: 800,
        letterSpacing: "-0.04em",
        lineHeight: 1,
        color: "currentColor",
        fontFamily: "Inter, system-ui, sans-serif",
        whiteSpace: "nowrap",
      }}
    >
      Advise<span style={{ color: "var(--brand-teal)" }}>.</span>
    </span>
  );
}

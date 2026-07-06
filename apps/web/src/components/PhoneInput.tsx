import { useMemo } from "react";

/**
 * Phone field with a country dial-code selector (defaults to USA +1) followed by the number.
 * Stores the value as "<dial> <number>" (e.g. "+1 3035550100") so it's SMS/E.164-friendly —
 * the server's phone normalizer turns that into E.164 for dedupe and messaging.
 */
export const COUNTRIES = [
  { code: "US", name: "United States", dial: "+1" },
  { code: "CA", name: "Canada", dial: "+1" },
  { code: "MX", name: "Mexico", dial: "+52" },
  { code: "GB", name: "United Kingdom", dial: "+44" },
  { code: "IE", name: "Ireland", dial: "+353" },
  { code: "AU", name: "Australia", dial: "+61" },
  { code: "NZ", name: "New Zealand", dial: "+64" },
  { code: "IN", name: "India", dial: "+91" },
  { code: "DE", name: "Germany", dial: "+49" },
  { code: "FR", name: "France", dial: "+33" },
  { code: "ES", name: "Spain", dial: "+34" },
  { code: "IT", name: "Italy", dial: "+39" },
  { code: "BR", name: "Brazil", dial: "+55" },
  { code: "AE", name: "United Arab Emirates", dial: "+971" },
  { code: "SA", name: "Saudi Arabia", dial: "+966" },
  { code: "ZA", name: "South Africa", dial: "+27" },
];
const DEFAULT_COUNTRY = "US";

const dialFor = (code: string) => COUNTRIES.find((c) => c.code === code)?.dial ?? "+1";

/** Split a stored value into a country code + local number. */
function parseValue(value: string): { code: string; local: string } {
  const v = (value ?? "").trim();
  if (v.startsWith("+")) {
    const dials = [...new Set(COUNTRIES.map((c) => c.dial))].sort((a, b) => b.length - a.length);
    for (const dial of dials) {
      if (v.startsWith(dial)) {
        const code = COUNTRIES.find((c) => c.dial === dial)!.code;
        return { code, local: v.slice(dial.length).trim() };
      }
    }
    return { code: DEFAULT_COUNTRY, local: v };
  }
  return { code: DEFAULT_COUNTRY, local: v };
}

export function PhoneInput({
  value,
  onChange,
  id,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
  placeholder?: string;
}) {
  const { code, local } = useMemo(() => parseValue(value), [value]);

  function emit(nextCode: string, nextLocal: string) {
    const trimmed = nextLocal.trim();
    onChange(trimmed ? `${dialFor(nextCode)} ${trimmed}` : "");
  }

  return (
    <div className="phone-input">
      <select aria-label="Country code" value={code} onChange={(e) => emit(e.target.value, local)}>
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code} title={c.name}>
            {c.code} {c.dial}
          </option>
        ))}
      </select>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        placeholder={placeholder ?? "Phone number"}
        value={local}
        onChange={(e) => emit(code, e.target.value)}
      />
    </div>
  );
}

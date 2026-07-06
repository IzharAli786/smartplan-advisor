import type { PersonalizationTag } from "../components/RichTextEditor.tsx";

/** Personalization tags available in email templates. */
export const EMAIL_TAGS: PersonalizationTag[] = [
  { tag: "first_name", label: "First name" },
  { tag: "full_name", label: "Full name" },
  { tag: "company", label: "Company" },
  { tag: "email", label: "Prospect email" },
  { tag: "state", label: "State" },
  { tag: "product", label: "Product" },
  { tag: "advisor_name", label: "Advisor name" },
  { tag: "advisor_email", label: "Advisor email" },
  { tag: "advisor_phone", label: "Advisor phone" },
];

export type TagContext = Partial<Record<string, string | null | undefined>>;

/** Replace {{tag}} occurrences with values from the context (unknown tags → blank). */
export function resolveTags(text: string, ctx: TagContext): string {
  return (text || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const v = ctx[key];
    return v == null ? "" : String(v);
  });
}

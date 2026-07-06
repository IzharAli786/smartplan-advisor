import { useEffect, useRef } from "react";
import { Icon, type IconName } from "./Icon.tsx";

export interface PersonalizationTag {
  tag: string; // e.g. "first_name"
  label: string; // e.g. "First name"
}

/**
 * Lightweight rich-text editor (contentEditable + toolbar) for email bodies:
 * bold/italic/underline, lists, links, inline images (by URL), tables, and inserting
 * personalization tags like {{first_name}}. Emits HTML via onChange.
 */
export default function RichTextEditor({
  value,
  onChange,
  tags = [],
  minHeight = 220,
}: {
  value: string;
  onChange: (html: string) => void;
  tags?: PersonalizationTag[];
  minHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Sync external value in only when it differs and we're not actively editing (avoids caret jumps).
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.innerHTML !== value) el.innerHTML = value || "";
  }, [value]);

  function emit() {
    onChange(ref.current?.innerHTML ?? "");
  }

  function exec(command: string, arg?: string) {
    ref.current?.focus();
    document.execCommand(command, false, arg);
    emit();
  }

  function insertHtml(html: string) {
    ref.current?.focus();
    document.execCommand("insertHTML", false, html);
    emit();
  }

  function addLink() {
    const url = window.prompt("Link URL", "https://");
    if (url) exec("createLink", url);
  }
  function addImage() {
    const url = window.prompt("Image URL", "https://");
    if (url) exec("insertImage", url);
  }
  function addTable() {
    const cols = Math.max(1, Math.min(8, Number(window.prompt("Columns?", "2")) || 2));
    const rows = Math.max(1, Math.min(20, Number(window.prompt("Rows?", "2")) || 2));
    const cell = '<td style="border:1px solid #ccc;padding:6px;">&nbsp;</td>';
    const row = `<tr>${cell.repeat(cols)}</tr>`;
    insertHtml(`<table style="border-collapse:collapse;width:100%;">${row.repeat(rows)}</table><p></p>`);
  }

  const btn = (title: string, icon: IconName, onClick: () => void) => (
    <button type="button" className="rte-btn" title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      <Icon name={icon} size={16} />
    </button>
  );

  return (
    <div className="rte">
      <div className="rte-toolbar">
        {btn("Bold", "bold", () => exec("bold"))}
        {btn("Italic", "italic", () => exec("italic"))}
        {btn("Underline", "underline", () => exec("underline"))}
        <span className="rte-sep" />
        {btn("Bulleted list", "list", () => exec("insertUnorderedList"))}
        {btn("Numbered list", "list-ordered", () => exec("insertOrderedList"))}
        <span className="rte-sep" />
        {btn("Link", "link", addLink)}
        {btn("Image", "image", addImage)}
        {btn("Table", "table", addTable)}
        {tags.length > 0 && (
          <select
            className="rte-tags"
            value=""
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              if (e.target.value) insertHtml(`{{${e.target.value}}}`);
              e.target.value = "";
            }}
            title="Insert a personalization tag"
          >
            <option value="">Insert tag…</option>
            {tags.map((t) => (
              <option key={t.tag} value={t.tag}>
                {t.label}
              </option>
            ))}
          </select>
        )}
      </div>
      <div
        ref={ref}
        className="rte-body"
        contentEditable
        onInput={emit}
        onBlur={emit}
        style={{ minHeight }}
        suppressContentEditableWarning
      />
    </div>
  );
}

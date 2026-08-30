/**
 * Markdown rendering — a Server Component.
 *
 * Note bodies are user input, and some arrive from imported .docx. They go
 * through `marked` and then `sanitize-html` with a tight allowlist before they
 * are ever handed to `dangerouslySetInnerHTML`: no script/style/iframe/object/
 * embed, no `on*` handlers (nothing outside the attribute allowlist survives),
 * and no `javascript:` URLs (only http/https/mailto schemes are allowed).
 */
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "a", "p", "h1", "h2", "h3",
    "ul", "ol", "li",
    "code", "pre", "blockquote",
    "strong", "em", "hr", "br", "img",
    "table", "thead", "tbody", "tr", "th", "td",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height"],
    code: ["class"],
    th: ["colspan", "rowspan"],
    td: ["colspan", "rowspan"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesAppliedToAttributes: ["href", "src"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  // Drop the *contents* of these too, not just the tags.
  nonTextTags: ["script", "style", "textarea", "option", "noscript", "iframe", "object", "embed"],
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" },
    }),
  },
};

export function renderMarkdown(src: string): string {
  if (!src) return "";
  const html = marked.parse(src, { async: false, gfm: true, breaks: false });
  return sanitizeHtml(html, OPTIONS);
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const html = renderMarkdown(source ?? "");
  return (
    <div
      className={["prose-note", className].filter(Boolean).join(" ")}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

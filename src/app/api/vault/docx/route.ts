import fs from "node:fs/promises";
import path from "node:path";

import mammoth from "mammoth";
import sanitizeHtml from "sanitize-html";

import { insideVaultReal } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A .docx, read as HTML.
 *
 * mammoth turns the document's own styles into semantic tags — a Word "Heading
 * 2" becomes an `<h2>` rather than bold 14pt text — so the result drops into
 * `.prose-note` and reads like every other note in the app.
 *
 * The output is Word's markup, not ours, so it is sanitised on the way out with
 * the same posture as `renderMarkdown`: no script, style, iframe, object or
 * embed and nothing outside the attribute allowlist, which is what makes it
 * safe for the reader to hand to `dangerouslySetInnerHTML`. Sanitising here
 * rather than in the browser also means the untrusted string never exists on
 * the client in an unsanitised form.
 */

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li",
    "strong", "em", "b", "i", "u", "s", "sup", "sub",
    "a", "br", "hr", "img",
    "blockquote", "pre", "code",
    "table", "thead", "tbody", "tr", "th", "td",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height"],
    th: ["colspan", "rowspan"],
    td: ["colspan", "rowspan"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  // mammoth inlines embedded images as base64, so img — and only img — may
  // carry a data: URL.
  allowedSchemesByTag: { img: ["data", "http", "https"] },
  allowedSchemesAppliedToAttributes: ["href", "src"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  nonTextTags: ["script", "style", "textarea", "option", "noscript", "iframe", "object", "embed"],
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" },
    }),
  },
};

const problem = (status: number, error: string) => Response.json({ error }, { status });

export async function GET(request: Request) {
  const rel = new URL(request.url).searchParams.get("path") ?? "";
  if (!rel) return problem(400, "Add ?path= to say which document you want.");

  let abs: string;
  try {
    // Resolved through symlinks: `readFile` would otherwise follow one out of
    // the vault to any .docx on the machine.
    abs = await insideVaultReal(rel);
  } catch {
    return problem(400, "That path is outside the notes vault.");
  }

  if (path.extname(abs).toLowerCase() !== ".docx") {
    // .doc is a different, binary format that mammoth cannot read.
    return problem(415, "Only .docx files can be read in the app. Download this one instead.");
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(abs);
  } catch {
    return problem(404, "There's no document at that path.");
  }

  try {
    const result = await mammoth.convertToHtml({ buffer });
    const html = sanitizeHtml(result.value ?? "", OPTIONS);
    return Response.json(
      { html },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return problem(422, "This document couldn't be read. Download it to open it in Word.");
  }
}

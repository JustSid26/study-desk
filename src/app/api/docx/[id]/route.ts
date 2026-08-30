import { readFile, stat } from "node:fs/promises";

import { eq } from "drizzle-orm";
import mammoth from "mammoth";
import sanitizeHtml from "sanitize-html";

import { db } from "@/db";
import { files } from "@/db/schema";
import { resolveUpload } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Render a stored .docx as HTML for the note viewer.
 *
 * mammoth's output is derived from a file a person dropped in, so it is exactly
 * as untrusted as any other user string: it goes through the same tight
 * sanitize-html allowlist the Markdown renderer uses before it leaves here.
 */

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Same allowlist as the Markdown renderer: structure and emphasis, no scripting surface. */
const ALLOWED: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "hr",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "strong", "b", "em", "i", "u", "s", "del", "ins", "sup", "sub", "mark",
    "blockquote", "pre", "code",
    "ul", "ol", "li",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td",
    "a", "img",
  ],
  allowedAttributes: {
    a: ["href", "title"],
    img: ["src", "alt", "title", "width", "height"],
    th: ["colspan", "rowspan"],
    td: ["colspan", "rowspan"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  // mammoth inlines embedded pictures as data URIs; allow those on <img> only.
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  allowedSchemesAppliedToAttributes: ["href", "src"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", {
      rel: "noopener noreferrer nofollow",
      target: "_blank",
    }),
  },
  exclusiveFilter: (frame) => {
    // An SVG data URI in an <img> is a scripting surface in some contexts.
    if (frame.tag !== "img") return false;
    const src = frame.attribs.src ?? "";
    return /^data:/i.test(src) && !/^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i.test(src);
  },
};

function isDocx(mime: string, name: string): boolean {
  return mime === DOCX_MIME || /\.docx$/i.test(name);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const rows = await db.select().from(files).where(eq(files.id, id)).limit(1);
  if (!rows.length) {
    return Response.json({ error: "That file is not in the library." }, { status: 404 });
  }
  const row = rows[0];

  if (!isDocx(row.mime, row.name)) {
    return Response.json(
      {
        error:
          "That file is not a Word .docx, so there is nothing to render. Open it with the download link instead.",
      },
      { status: 400 },
    );
  }

  let abs: string;
  try {
    abs = resolveUpload(row.path);
  } catch {
    return Response.json({ error: "That file has an invalid location." }, { status: 400 });
  }

  let buffer: Buffer;
  try {
    const info = await stat(abs);
    if (!info.isFile()) throw new Error("not a file");
    buffer = await readFile(abs);
  } catch {
    return Response.json(
      { error: "The stored copy of that file is missing." },
      { status: 404 },
    );
  }

  try {
    const result = await mammoth.convertToHtml({ buffer });
    const html = sanitizeHtml(result.value, ALLOWED);
    return Response.json({ html }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    // Never surface a stack trace — the old .doc format and corrupt zips both land here.
    return Response.json(
      {
        error:
          "That document could not be read. Word's older .doc format is not supported — re-save it as .docx and upload it again.",
      },
      { status: 422 },
    );
  }
}

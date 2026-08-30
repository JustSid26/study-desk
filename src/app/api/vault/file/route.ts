import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { insideVaultReal } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Raw bytes out of the notes vault.
 *
 * Everything the reader can't render as text goes through here: the `<img>` for
 * a screenshot, the `<iframe>` for a PDF, and every download link. The path
 * arrives from a URL, so it is resolved through `insideVault` first — that is
 * the whole security boundary, and a path that escapes the vault throws, which
 * becomes a 400 rather than a file read.
 *
 * The file is streamed rather than buffered: a 60 MB scan would otherwise sit
 * in memory in full before the first byte reached the browser.
 */

const MIME: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".heic": "image/heic",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip",
};

/**
 * SVG renders script when it is opened as a document, so it is only ever handed
 * over as a download. Everything else unknown is octet-stream, which browsers
 * will not execute.
 */
const INLINE_SAFE = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/heic",
  "application/pdf",
  "text/plain; charset=utf-8", "text/markdown; charset=utf-8", "text/csv; charset=utf-8",
]);

/**
 * RFC 6266: a quoted ASCII fallback for old clients plus a percent-encoded
 * UTF-8 form for everyone else. Quotes, backslashes and control characters are
 * stripped from the fallback so a filename can never close the quoted string
 * and inject a second header parameter.
 */
function contentDisposition(name: string, attachment: boolean): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "file";
  const encoded = encodeURIComponent(name);
  return `${attachment ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

const problem = (status: number, detail: string) =>
  new Response(detail, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rel = url.searchParams.get("path") ?? "";
  if (!rel) return problem(400, "Add ?path= to say which file you want.");

  let abs: string;
  try {
    // The real path, not just the lexical one: this streams whatever it is
    // handed, so a symlink inside the vault must not be followed out of it.
    abs = await insideVaultReal(rel);
  } catch {
    return problem(400, "That path is outside the notes vault.");
  }

  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    return problem(404, "There's no file at that path.");
  }
  if (stat.isDirectory()) return problem(400, "That's a folder, not a file.");

  const name = path.basename(abs);
  const type = MIME[path.extname(abs).toLowerCase()] ?? "application/octet-stream";
  const wantsDownload = url.searchParams.get("download") === "1";
  const attachment = wantsDownload || !INLINE_SAFE.has(type);

  const body = Readable.toWeb(
    createReadStream(abs),
  ) as unknown as ReadableStream<Uint8Array>;

  return new Response(body, {
    headers: {
      "content-type": type,
      "content-length": String(stat.size),
      "content-disposition": contentDisposition(name, attachment),
      // The vault is local and mutable — a cached PDF would outlive the edit
      // that replaced it, so nothing here is cacheable.
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "last-modified": new Date(stat.mtimeMs).toUTCString(),
    },
  });
}

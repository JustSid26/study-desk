import fs from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { files } from "@/db/schema";
import { resolveUpload } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serve an uploaded original straight off disk.
 *
 * Ids are content-stable — a file row's bytes never change once written, a new
 * upload gets a new id — so the response is safe to cache hard and privately.
 */

/** RFC 6266 quoted-string: escape \ and ", drop control characters. */
function quoteFilename(name: string): string {
  return name.replace(/[\x00-\x1f\x7f]/g, "").replace(/["\\]/g, "\\$&");
}

/** ASCII fallback for the plain `filename=` parameter. */
function asciiFilename(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").trim();
  return ascii || "download";
}

function contentDisposition(name: string, attachment: boolean): string {
  const type = attachment ? "attachment" : "inline";
  const plain = quoteFilename(asciiFilename(name));
  const encoded = encodeURIComponent(name);
  return `${type}; filename="${plain}"; filename*=UTF-8''${encoded}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const rows = await db.select().from(files).where(eq(files.id, id)).limit(1);
  if (!rows.length) {
    return Response.json({ error: "That file is not in the library." }, { status: 404 });
  }
  const row = rows[0];

  let abs: string;
  try {
    abs = resolveUpload(row.path);
  } catch {
    // A tampered path column — refuse rather than read an arbitrary file.
    return Response.json({ error: "That file has an invalid location." }, { status: 400 });
  }

  let size: number;
  try {
    const info = await stat(abs);
    if (!info.isFile()) throw new Error("not a file");
    size = info.size;
  } catch {
    return Response.json(
      { error: "The stored copy of that file is missing." },
      { status: 404 },
    );
  }

  const download = new URL(request.url).searchParams.get("download") === "1";

  const headers = new Headers({
    "Content-Type": row.mime || "application/octet-stream",
    "Content-Length": String(size),
    "Content-Disposition": contentDisposition(row.name || id, download),
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });

  const body = Readable.toWeb(
    fs.createReadStream(abs),
  ) as unknown as ReadableStream<Uint8Array>;

  return new Response(body, { status: 200, headers });
}

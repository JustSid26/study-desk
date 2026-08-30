import { randomUUID, randomBytes } from "node:crypto";

/** Short, sortable-ish, collision-safe enough for a personal database. */
export function newId(): string {
  return (
    Date.now().toString(36) + randomBytes(5).toString("hex")
  );
}

export { randomUUID };

/** Safe filename fragment for an uploaded file: keeps the extension, drops everything else. */
export function safeExtension(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name ?? "");
  return m ? `.${m[1].toLowerCase()}` : "";
}

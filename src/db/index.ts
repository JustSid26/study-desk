import "server-only";

import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";
import { DB_FILE } from "@/lib/paths";

/**
 * One connection per process. Next dev re-evaluates modules on every edit, so
 * the client is parked on globalThis — otherwise each hot reload would open a
 * fresh handle to the same SQLite file and they would fight over the lock.
 */
const globalForDb = globalThis as unknown as { __studyDb?: Client };

function client(): Client {
  if (!globalForDb.__studyDb) {
    globalForDb.__studyDb = createClient({
      url: process.env.DATABASE_URL ?? `file:${DB_FILE}`,
      authToken: process.env.DATABASE_AUTH_TOKEN,
    });
  }
  return globalForDb.__studyDb;
}

export const db = drizzle(client(), { schema });
export { schema };

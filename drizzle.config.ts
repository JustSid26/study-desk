import path from "node:path";
import type { Config } from "drizzle-kit";

const dataDir = process.env.STUDY_DATA_DIR ?? path.join(process.cwd(), "data");

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? `file:${path.join(dataDir, "study.db")}`,
  },
  strict: true,
  verbose: true,
} satisfies Config;

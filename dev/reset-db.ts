// Rebuilds a local Postgres database for development and tests:
// a small stand-in for Supabase's own schemas, then every migration in order.
//
//   YT_ADMIN_URL   connection to any database on the server, as a superuser
//                  (default postgresql://ytdev:ytdev@localhost:5432/postgres)
//   npx tsx dev/reset-db.ts <database-name> [more names...]

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const adminUrl = process.env.YT_ADMIN_URL ?? "postgresql://ytdev:ytdev@localhost:5432/postgres";

export async function resetDatabase(name: string): Promise<string> {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`bad database name: ${name}`);
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists ${name} with (force)`);
  await admin.unsafe(`create database ${name}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const db = postgres(url.toString(), { max: 1, onnotice: () => {} });
  await db.unsafe(readFileSync(join(root, "dev/supabase-stub.sql"), "utf8"));
  const dir = join(root, "supabase/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await db.unsafe(readFileSync(join(dir, file), "utf8"));
    } catch (err) {
      await db.end();
      throw new Error(`${file}: ${(err as Error).message}`);
    }
  }
  await db.end();
  return url.toString();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const name of process.argv.slice(2)) {
    console.log(`${name} ready at ${await resetDatabase(name)}`);
  }
}

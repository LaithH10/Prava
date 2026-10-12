// Applies the Prisma schema (indexes) to the isolated test database only.
// Usage: yarn db:push:test   (never touches the app database)
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

process.env.RUN_DB_TESTS = "1";
const { assertIsolatedTestDatabase } = await import("./helpers.js");
const { prisma } = await import("../config/prismaConfig.js");

await assertIsolatedTestDatabase(prisma);
await prisma.$disconnect();

const prismaCli = fileURLToPath(import.meta.resolve("prisma/build/index.js"));
const result = spawnSync(
  process.execPath,
  [prismaCli, "db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"],
  { stdio: "inherit", env: process.env }
);
process.exit(result.status ?? 1);

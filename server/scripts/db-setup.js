// Guarded schema and index setup for the development or test database ONLY.
//
//   yarn db:setup:dev    -> server/.env       DATABASE_URL,      must be prava_dev
//   yarn db:setup:test   -> server/.env.test  TEST_DATABASE_URL, must be prava_test
//
// Before changing anything it checks the live connection: the database name must
// match, and the user may only hold read/readWrite roles on that database.
// Steps: prisma db push, backfill Residency.status, create and verify the partial
// unique index for pending visit requests.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { APP_DATABASE } from "../config/databaseGuard.js";
import {
  createPendingIndex,
  listVisitRequestIndexes,
  verifyPendingIndex,
} from "../config/indexes.js";

const TARGETS = {
  dev: { file: "../.env", variable: "DATABASE_URL", database: "prava_dev" },
  test: { file: "../.env.test", variable: "TEST_DATABASE_URL", database: "prava_test" },
};

const fail = (message) => {
  console.error(`REFUSED: ${message}`);
  process.exit(1);
};

const target = TARGETS[process.argv[2]];
if (!target) fail("usage: node scripts/db-setup.js dev|test");

const envPath = new URL(target.file, import.meta.url);
if (!fs.existsSync(envPath)) fail(`${target.file} not found`);
const url = dotenv.parse(fs.readFileSync(envPath))[target.variable];
if (!url) fail(`${target.variable} missing in ${target.file}`);

let dbName;
try {
  dbName = new URL(url).pathname.slice(1);
} catch {
  fail(`${target.variable} is not a valid connection string`);
}
if (dbName === APP_DATABASE || dbName !== target.database) {
  fail(`connection string points at "${dbName}", expected "${target.database}"`);
}

process.env.DATABASE_URL = url;
const prisma = new PrismaClient();

const { db } = await prisma.$runCommandRaw({ dbStats: 1 });
const status = await prisma.$runCommandRaw({ connectionStatus: 1 });
const roles = status.authInfo?.authenticatedUserRoles ?? [];
const tooBroad = roles.filter(
  ({ role, db: roleDb }) => roleDb !== target.database || !["read", "readWrite"].includes(role)
);
if (db !== target.database || roles.length === 0 || tooBroad.length) {
  await prisma.$disconnect();
  fail(`live connection is "${db}" with roles ${JSON.stringify(roles)}`);
}
console.log(`Guard passed: ${db}, roles ${JSON.stringify(roles)}`);

// 1. Collections and Prisma-declared indexes.
const require = createRequire(import.meta.url);
const prismaCli = require.resolve("prisma/build/index.js");
const push = spawnSync(
  process.execPath,
  [prismaCli, "db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"],
  { cwd: new URL("..", import.meta.url), stdio: "inherit", env: process.env }
);
if (push.status !== 0) {
  await prisma.$disconnect();
  fail("prisma db push failed");
}

// 2. Listings created before milestone 3 have no status field: mark them ACTIVE.
const backfill = await prisma.$runCommandRaw({
  update: "Residency",
  updates: [{ q: { status: { $exists: false } }, u: { $set: { status: "ACTIVE" } }, multi: true }],
});
console.log(`Backfilled status on ${backfill.nModified ?? 0} listing(s)`);

// 3. Partial unique index for pending visit requests, then verify it.
await createPendingIndex(prisma);
verifyPendingIndex(await listVisitRequestIndexes(prisma));
console.log("Partial index visit_request_one_pending verified");

await prisma.$disconnect();

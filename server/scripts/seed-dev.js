// Loads the fictional sample listings (data/Residency.json) into prava_dev ONLY.
//   yarn seed:dev
// Guarded like db-setup: refuses unless the live connection is prava_dev with
// read/readWrite roles on it only. Idempotent: existing addresses are skipped.
import fs from "node:fs";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { createResidencySchema } from "../validation/schemas.js";

const DEV_DATABASE = "prava_dev";
// A demo owner without any personal data; it can't log in (no Auth0 account).
const DEMO_OWNER = { authId: "seed-prava-demo", name: "Prava demo", emailVerified: false };

const fail = (message) => {
  console.error(`REFUSED: ${message}`);
  process.exit(1);
};

const url = dotenv.parse(fs.readFileSync(new URL("../.env", import.meta.url))).DATABASE_URL;
if (!url || new URL(url).pathname.slice(1) !== DEV_DATABASE) fail(`DATABASE_URL must point at ${DEV_DATABASE}`);
process.env.DATABASE_URL = url;

const prisma = new PrismaClient();
const { db } = await prisma.$runCommandRaw({ dbStats: 1 });
const roles = (await prisma.$runCommandRaw({ connectionStatus: 1 })).authInfo?.authenticatedUserRoles ?? [];
if (db !== DEV_DATABASE || roles.length === 0 || roles.some((r) => r.db !== DEV_DATABASE || !["read", "readWrite"].includes(r.role))) {
  await prisma.$disconnect();
  fail(`live connection is "${db}" with roles ${JSON.stringify(roles)}`);
}

const listings = JSON.parse(fs.readFileSync(new URL("../data/Residency.json", import.meta.url)));
const owner = await prisma.user.upsert({
  where: { authId: DEMO_OWNER.authId },
  update: {},
  create: DEMO_OWNER,
});

let created = 0;
for (const raw of listings) {
  const data = createResidencySchema.parse(raw);
  const exists = await prisma.residency.findFirst({ where: { ownerId: owner.id, address: data.address } });
  if (exists) continue;
  await prisma.residency.create({ data: { ...data, ownerId: owner.id } });
  created++;
}
console.log(`Seeded ${created} listing(s) into ${db} (${listings.length - created} already present)`);
await prisma.$disconnect();

// Shared setup for database integration tests (RUN_DB_TESTS=1, prava_test only).
//
// start(): verifies the live connection (database name and roles) and the partial
// unique index BEFORE anything is written, then starts the app with high rate
// limits. cleanup(): removes only data created by this run's users, and only if
// the safety checks passed.
import { RUN_DB_TESTS, assertIsolatedTestDatabase, signToken } from "./helpers.js";
import { escapeRegex } from "../utils/regex.js";

export { RUN_DB_TESTS };

export const createDbHarness = async (label) => {
  const { createApp } = await import("../app.js");
  const { prisma } = await import("../config/prismaConfig.js");
  const { listVisitRequestIndexes, verifyPendingIndex } = await import("../config/indexes.js");

  // Only letters, digits and dashes: the prefix is matched with startsWith, which Prisma
  // turns into an unescaped regex (it is escaped below as well).
  const run = `test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let verified = false;
  let server;
  let base;
  let addressCounter = 0;

  const call = async (path, { method = "POST", token, body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  return {
    run,
    prisma,
    call,
    get base() {
      return base;
    },

    async start() {
      await assertIsolatedTestDatabase(prisma);
      verifyPendingIndex(await listVisitRequestIndexes(prisma));
      verified = true;
      server = createApp({ rateLimits: { writesPerMinute: 1e6, readsPerMinute: 1e6 } }).listen(0);
      await new Promise((resolve) => server.once("listening", resolve));
      base = `http://127.0.0.1:${server.address().port}/api`;
    },

    // A verified user token for this run, e.g. token("owner").
    token: (name, options = {}) =>
      signToken({ sub: `${run}-${name}`, email: `${name}@example.com`, ...options }),

    // A valid listing body with an address unique to this run.
    property: (overrides = {}) => ({
      title: "Test house",
      description: "Created by the API tests",
      price: 250000,
      address: `Teststraat ${run} ${++addressCounter}`,
      city: "Utrecht",
      country: "Netherlands",
      image: "https://example.com/house.jpg",
      facilities: { bedrooms: 3, bathrooms: 1, parkings: 1 },
      ...overrides,
    }),

    // Creates a listing as `token` and returns its id.
    async createListing(token, overrides) {
      const res = await call("/residency/create", { token, body: this.property(overrides) });
      if (res.status !== 201) throw new Error(`createListing failed: ${res.status} ${JSON.stringify(res.body)}`);
      return res.body.residency.id;
    },

    async cleanup() {
      server?.close();
      if (!verified) {
        // The safety checks failed or never ran: delete nothing.
        await prisma.$disconnect();
        return;
      }
      const users = await prisma.user.findMany({ where: { authId: { startsWith: escapeRegex(`${run}-`) } }, select: { id: true } });
      const ids = users.map((u) => u.id);
      const owned = await prisma.residency.findMany({ where: { ownerId: { in: ids } }, select: { id: true } });
      const ownedIds = owned.map((r) => r.id);
      await prisma.visitRequest.deleteMany({
        where: { OR: [{ requesterId: { in: ids } }, { residencyId: { in: ownedIds } }] },
      });
      await prisma.favourite.deleteMany({
        where: { OR: [{ userId: { in: ids } }, { residencyId: { in: ownedIds } }] },
      });
      await prisma.residency.deleteMany({ where: { id: { in: ownedIds } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
      await prisma.$disconnect();
    },
  };
};

// "YYYY-MM-DD", `days` after today's Amsterdam date.
export const dayFromToday = async (days) => {
  const { todayInAmsterdam } = await import("../utils/dates.js");
  const d = new Date(`${todayInAmsterdam()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

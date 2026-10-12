// Integration tests against the isolated test database. Opt-in:
//   RUN_DB_TESTS=1 yarn test        (after `yarn db:push:test` once)
// Before anything is written, the live connection is checked: it must be the
// *_test database and the user may only hold read/readWrite on it. Cleanup removes
// only users with this run's authId prefix and the properties they own.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { RUN_DB_TESTS, assertIsolatedTestDatabase, signToken } from "./helpers.js";

const { createApp } = await import("../app.js");
const { prisma } = await import("../config/prismaConfig.js");

describe("with the isolated test database", { skip: !RUN_DB_TESTS }, () => {
  const run = `test|${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const subA = `${run}-a`;
  const subB = `${run}-b`;
  const MISSING = "507f1f77bcf86cd799439011";
  let server;
  let base;
  let tokenA;
  let tokenB;
  let residencyId;
  // Set only after the live connection passed the safety check; cleanup requires it.
  let verifiedTestDatabase = false;

  const property = {
    title: "Test house",
    description: "Created by the API tests",
    price: 250000,
    address: `Teststraat ${run}`,
    city: "Utrecht",
    country: "Netherlands",
    image: "https://example.com/house.jpg",
    facilities: { bedrooms: 3, bathrooms: 1, parkings: 1 },
  };

  const call = (path, { method = "POST", token, body } = {}) =>
    fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const json = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });

  before(async () => {
    await assertIsolatedTestDatabase(prisma);
    verifiedTestDatabase = true;
    server = createApp().listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}/api`;
    tokenA = await signToken({ sub: subA, email: "a@example.com" });
    tokenB = await signToken({ sub: subB, email: "b@example.com" });
  });

  after(async () => {
    server?.close();
    if (!verifiedTestDatabase) {
      // Setup failed or the safety check rejected the connection: delete nothing.
      await prisma.$disconnect();
      return;
    }
    const users = await prisma.user.findMany({
      where: { authId: { startsWith: run } },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    await prisma.residency.deleteMany({ where: { ownerId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  test("register creates the caller from the token, ignoring identity in the body", async () => {
    const { status, body } = await json(
      await call("/user/register", {
        token: tokenA,
        body: {
          name: "Alice",
          authId: subB,
          email: "evil@example.com",
          emailVerified: true,
          bookedVisits: [{ id: MISSING }],
        },
      })
    );
    assert.equal(status, 200);
    assert.equal(body.user.name, "Alice");
    assert.equal(body.user.email, "a@example.com");
    assert.equal(body.user.authId, undefined);

    const stored = await prisma.user.findUnique({ where: { authId: subA } });
    assert.equal(stored.email, "a@example.com");
    assert.deepEqual(stored.bookedVisits, []);
    assert.equal(await prisma.user.count({ where: { authId: subB } }), 0);
  });

  test("register rejects profile fields that aren't allowed values", async () => {
    const res = await call("/user/register", { token: tokenA, body: { image: "javascript:alert(1)" } });
    assert.equal(res.status, 400);
  });

  test("token email changes are synced on the next request", async () => {
    const token = await signToken({ sub: subA, email: "a2@example.com" });
    assert.equal((await call("/user/bookings", { method: "GET", token })).status, 200);
    const stored = await prisma.user.findUnique({ where: { authId: subA } });
    assert.equal(stored.email, "a2@example.com");
  });

  test("create a property: the owner is always the caller", async () => {
    const userB = (await json(await call("/user/register", { token: tokenB }))).body.user;
    const { status, body } = await json(
      await call("/residency/create", {
        token: tokenA,
        body: { ...property, ownerId: userB.id, userEmail: "b@example.com" },
      })
    );
    assert.equal(status, 200);
    residencyId = body.residency.id;
    const userA = await prisma.user.findUnique({ where: { authId: subA } });
    assert.equal(body.residency.ownerId, userA.id);
  });

  test("duplicate property for the same owner returns 409", async () => {
    const res = await call("/residency/create", { token: tokenA, body: property });
    assert.equal(res.status, 409);
  });

  test("another owner may list the same address", async () => {
    const res = await call("/residency/create", { token: tokenB, body: property });
    assert.equal(res.status, 200);
  });

  test("property with missing fields returns 400", async () => {
    const res = await call("/residency/create", { token: tokenA, body: { title: "x" } });
    assert.equal(res.status, 400);
  });

  test("public detail route works without a token; unknown id returns 404", async () => {
    assert.equal((await fetch(`${base}/residency/${residencyId}`)).status, 200);
    assert.equal((await fetch(`${base}/residency/${MISSING}`)).status, 404);
    assert.equal((await fetch(`${base}/residency/allresd`)).status, 200);
  });

  test("booking: invalid date 400, unknown property 404, duplicate 400", async () => {
    const path = `/user/bookVisit/${residencyId}`;
    assert.equal((await call(path, { token: tokenA, body: { date: "not a date" } })).status, 400);
    assert.equal(
      (await call(`/user/bookVisit/${MISSING}`, { token: tokenA, body: { date: "2026-11-01" } })).status,
      404
    );
    assert.equal((await call(path, { token: tokenA, body: { date: "2026-11-01" } })).status, 200);
    assert.equal((await call(path, { token: tokenA, body: { date: "2026-11-02" } })).status, 400);
  });

  test("isolation: B cannot see or cancel A's booking", async () => {
    const bookingsB = await json(await call("/user/bookings", { method: "GET", token: tokenB }));
    assert.deepEqual(bookingsB.body.bookedVisits, []);

    const cancelByB = await call(`/user/removeBooking/${residencyId}`, {
      token: tokenB,
      body: { email: "a@example.com", authId: subA },
    });
    assert.equal(cancelByB.status, 404);

    const bookingsA = await json(await call("/user/bookings", { method: "GET", token: tokenA }));
    assert.equal(bookingsA.body.bookedVisits.length, 1);
  });

  test("favourites: toggle, isolation, unknown property 404", async () => {
    const path = `/user/toFav/${residencyId}`;
    assert.equal((await json(await call(path, { token: tokenA }))).body.message, "Updated favourites");

    const favB = await json(await call("/user/favourites", { method: "GET", token: tokenB }));
    assert.deepEqual(favB.body.favResidenciesID, []);
    const favA = await json(await call("/user/favourites", { method: "GET", token: tokenA }));
    assert.deepEqual(favA.body.favResidenciesID, [residencyId]);

    assert.equal((await json(await call(path, { token: tokenA }))).body.message, "Removed from favourites");
    assert.equal((await call(`/user/toFav/${MISSING}`, { token: tokenA })).status, 404);
  });

  test("cancel own booking, then cancelling again returns 404", async () => {
    const path = `/user/removeBooking/${residencyId}`;
    assert.equal((await call(path, { token: tokenA })).status, 200);
    assert.equal((await call(path, { token: tokenA })).status, 404);
  });
});

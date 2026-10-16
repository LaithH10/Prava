// Integration tests against the isolated test database. Opt-in:
//   RUN_DB_TESTS=1 yarn test   (after `yarn db:setup:test` once)
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { RUN_DB_TESTS, createDbHarness, dayFromToday } from "./dbHarness.js";

describe("milestone 3 API against the isolated test database", { skip: !RUN_DB_TESTS }, () => {
  let h;
  let owner, alice, bob;
  const MISSING = "507f1f77bcf86cd799439011";

  before(async () => {
    h = await createDbHarness("api");
    await h.start();
    [owner, alice, bob] = await Promise.all([h.token("owner"), h.token("alice"), h.token("bob")]);
    for (const t of [owner, alice, bob]) await h.call("/user/register", { token: t });
  });
  after(() => h?.cleanup());

  describe("profile", () => {
    test("register ignores identity fields and returns the caller's profile", async () => {
      const res = await h.call("/user/register", {
        token: alice,
        body: { name: "Alice", authId: "evil", email: "evil@example.com", emailVerified: true },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.user.name, "Alice");
      assert.equal(res.body.user.email, "alice@example.com");
    });

    test("invalid profile values return VALIDATION_ERROR with fields", async () => {
      const res = await h.call("/user/register", { token: alice, body: { image: "javascript:alert(1)" } });
      assert.equal(res.status, 400);
      assert.equal(res.body.code, "VALIDATION_ERROR");
      assert.ok(res.body.fields.image);
    });
  });

  describe("listings", () => {
    test("create: 201, owner is always the caller", async () => {
      const bobUser = await h.prisma.user.findFirst({ where: { authId: `${h.run}-bob` } });
      const res = await h.call("/residency/create", { token: owner, body: { ...h.property(), ownerId: bobUser.id, status: "ARCHIVED" } });
      assert.equal(res.status, 201);
      const ownerUser = await h.prisma.user.findFirst({ where: { authId: `${h.run}-owner` } });
      assert.equal(res.body.residency.ownerId, ownerUser.id);
      assert.equal(res.body.residency.status, "ACTIVE");
    });

    test("create: invalid data returns field messages", async () => {
      const res = await h.call("/residency/create", { token: owner, body: { title: "x", price: -5, image: "http://insecure" } });
      assert.equal(res.status, 400);
      assert.equal(res.body.code, "VALIDATION_ERROR");
      for (const field of ["title", "price", "image", "description"]) assert.ok(res.body.fields[field], field);
    });

    test("create: duplicate address for the same owner → 409 DUPLICATE_ADDRESS; other owner allowed", async () => {
      const body = h.property();
      assert.equal((await h.call("/residency/create", { token: owner, body })).status, 201);
      const dup = await h.call("/residency/create", { token: owner, body });
      assert.equal(dup.status, 409);
      assert.equal(dup.body.code, "DUPLICATE_ADDRESS");
      assert.equal((await h.call("/residency/create", { token: alice, body })).status, 201);
    });

    test("PATCH: owner can edit allowed fields; non-owner gets 404; bad data 400", async () => {
      const id = await h.createListing(owner);
      const ok = await h.call(`/residency/${id}`, { method: "PATCH", token: owner, body: { price: 300000, ownerId: "x" } });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.residency.price, 300000);
      assert.equal((await h.call(`/residency/${id}`, { method: "PATCH", token: alice, body: { price: 1 } })).status, 404);
      const bad = await h.call(`/residency/${id}`, { method: "PATCH", token: owner, body: { price: "free" } });
      assert.equal(bad.status, 400);
      assert.equal((await h.call(`/residency/${id}`, { method: "PATCH", token: owner, body: {} })).status, 400);
    });

    test("public list: ACTIVE only, search, pagination without duplicates", async () => {
      const city = `Searchcity${Date.now()}`;
      const ids = [];
      for (let i = 0; i < 5; i++) ids.push(await h.createListing(owner, { city }));
      await h.call(`/residency/${ids[0]}/archive`, { token: owner });

      const seen = [];
      let cursor = null;
      do {
        const res = await h.call(`/residency/allresd?city=${city}&limit=2${cursor ? `&cursor=${cursor}` : ""}`, { method: "GET" });
        assert.equal(res.status, 200);
        seen.push(...res.body.items.map((r) => r.id));
        cursor = res.body.nextCursor;
      } while (cursor);
      assert.equal(seen.length, 4);
      assert.equal(new Set(seen).size, 4);
      assert.ok(!seen.includes(ids[0]), "archived listing must not appear");

      const q = await h.call(`/residency/allresd?q=${city.toLowerCase()}`, { method: "GET" });
      assert.equal(q.body.items.length, 4);
    });

    test("search input is treated as literal text, never as a regex", async () => {
      const city = `Literalcity${Date.now()}`;
      await h.createListing(owner, { city, title: "abc house" });
      const search = (q) => h.call(`/residency/allresd?q=${encodeURIComponent(q)}`, { method: "GET" });

      for (const q of ["(", "[", "*", "\\", "a.c house", "(a+)+$"]) {
        const res = await search(q);
        assert.equal(res.status, 200, `q=${q}`);
        assert.ok(!res.body.items.some((r) => r.city === city), `q=${q} must not match "abc house"`);
      }
      assert.equal((await search("abc house")).body.items.some((r) => r.city === city), true);
      const started = Date.now();
      await search(`${"a".repeat(30)}(a+)+$`);
      assert.ok(Date.now() - started < 5000, "pathological pattern must not be slow");
    });

    test("my listings: own only, status filter, pending visit-request counts", async () => {
      const id = await h.createListing(owner);
      await h.call("/user/visit-requests", { token: alice, body: { residencyId: id, requestedDate: await dayFromToday(5) } });
      const res = await h.call("/user/listings?status=ACTIVE", { method: "GET", token: owner });
      assert.equal(res.status, 200);
      const mine = res.body.items.find((l) => l.id === id);
      assert.equal(mine.pendingVisitRequests, 1);
      const aliceListings = await h.call("/user/listings", { method: "GET", token: alice });
      assert.ok(!aliceListings.body.items.some((l) => l.id === id));
    });
  });

  describe("archived listings (access matrix, plan 4.4)", () => {
    test("matrix: public/non-owner vs owner, favourites hidden, requests closed, restore", async () => {
      const id = await h.createListing(owner);
      // Before archiving: a favourite and a pending request from alice.
      assert.equal((await h.call(`/user/favourites/${id}`, { method: "PUT", token: alice })).status, 201);
      const req = await h.call("/user/visit-requests", { token: alice, body: { residencyId: id, requestedDate: await dayFromToday(3) } });
      assert.equal(req.status, 201);

      assert.equal((await h.call(`/residency/${id}/archive`, { token: alice })).status, 404, "non-owner archive");
      const archived = await h.call(`/residency/${id}/archive`, { token: owner });
      assert.equal(archived.status, 200);
      assert.equal(archived.body.residency.status, "ARCHIVED");
      assert.equal((await h.call(`/residency/${id}/archive`, { token: owner })).status, 200, "idempotent");

      // Public and non-owner: not found.
      assert.equal((await h.call(`/residency/${id}`, { method: "GET" })).status, 404);
      assert.equal((await h.call(`/residency/${id}`, { method: "GET", token: alice })).status, 404);
      assert.equal((await h.call(`/residency/${id}`, { method: "PATCH", token: alice, body: { price: 1 } })).status, 404);
      assert.equal((await h.call(`/user/favourites/${id}`, { method: "PUT", token: bob })).status, 404);
      const newReq = await h.call("/user/visit-requests", { token: bob, body: { residencyId: id, requestedDate: await dayFromToday(4) } });
      assert.equal(newReq.status, 404);

      // Owner: visible, editable, can't request own.
      const ownerView = await h.call(`/residency/${id}`, { method: "GET", token: owner });
      assert.equal(ownerView.status, 200);
      assert.equal(ownerView.body.status, "ARCHIVED");
      assert.equal((await h.call(`/residency/${id}`, { method: "PATCH", token: owner, body: { price: 199000 } })).status, 200);
      const own = await h.call("/user/visit-requests", { token: owner, body: { residencyId: id, requestedDate: await dayFromToday(4) } });
      assert.equal(own.status, 403);
      assert.equal(own.body.code, "OWN_LISTING");

      // Alice's favourite is hidden; her request is CLOSED with limited listing info.
      const favs = await h.call("/user/favourites", { method: "GET", token: alice });
      assert.ok(!favs.body.items.some((f) => f.residencyId === id));
      const mine = await h.call("/user/visit-requests", { method: "GET", token: alice });
      const closed = mine.body.items.find((r) => r.id === req.body.visitRequest.id);
      assert.equal(closed.status, "CLOSED");
      assert.deepEqual(closed.residency, { title: "Test house", available: false });

      // Restore: listing public again, favourite reappears, request stays CLOSED, new request works.
      assert.equal((await h.call(`/residency/${id}/restore`, { token: owner })).status, 200);
      assert.equal((await h.call(`/residency/${id}`, { method: "GET" })).status, 200);
      const favsAfter = await h.call("/user/favourites", { method: "GET", token: alice });
      assert.ok(favsAfter.body.items.some((f) => f.residencyId === id));
      const stillClosed = await h.prisma.visitRequest.findUnique({ where: { id: req.body.visitRequest.id } });
      assert.equal(stillClosed.status, "CLOSED");
      const again = await h.call("/user/visit-requests", { token: alice, body: { residencyId: id, requestedDate: await dayFromToday(6) } });
      assert.equal(again.status, 201);
    });
  });

  describe("favourites", () => {
    test("idempotent add/remove, own listing refused, isolation", async () => {
      const id = await h.createListing(owner);
      assert.equal((await h.call(`/user/favourites/${id}`, { method: "PUT", token: alice })).status, 201);
      assert.equal((await h.call(`/user/favourites/${id}`, { method: "PUT", token: alice })).status, 200);
      const own = await h.call(`/user/favourites/${id}`, { method: "PUT", token: owner });
      assert.equal(own.status, 403);
      assert.equal(own.body.code, "OWN_LISTING");
      assert.equal((await h.call(`/user/favourites/${MISSING}`, { method: "PUT", token: alice })).status, 404);

      const aliceFavs = await h.call("/user/favourites", { method: "GET", token: alice });
      assert.ok(aliceFavs.body.items.some((f) => f.residencyId === id));
      const bobFavs = await h.call("/user/favourites", { method: "GET", token: bob });
      assert.ok(!bobFavs.body.items.some((f) => f.residencyId === id));

      assert.equal((await h.call(`/user/favourites/${id}`, { method: "DELETE", token: alice })).status, 200);
      assert.equal((await h.call(`/user/favourites/${id}`, { method: "DELETE", token: alice })).status, 200);
      assert.equal(await h.prisma.favourite.count({ where: { residencyId: id } }), 0);
    });
  });

  describe("visit requests", () => {
    test("date rules, own listing, unknown listing", async () => {
      const id = await h.createListing(owner);
      for (const [days, rule] of [[0, "today"], [-1, "past"], [91, "more than 90 days"]]) {
        const res = await h.call("/user/visit-requests", { token: alice, body: { residencyId: id, requestedDate: await dayFromToday(days) } });
        assert.equal(res.status, 400, rule);
        assert.ok(res.body.fields.requestedDate, rule);
      }
      assert.equal((await h.call("/user/visit-requests", { token: alice, body: { residencyId: id, requestedDate: await dayFromToday(90) } })).status, 201);
      const own = await h.call("/user/visit-requests", { token: owner, body: { residencyId: id, requestedDate: await dayFromToday(2) } });
      assert.equal(own.body.code, "OWN_LISTING");
      assert.equal((await h.call("/user/visit-requests", { token: alice, body: { residencyId: MISSING, requestedDate: await dayFromToday(2) } })).status, 404);
    });

    test("duplicate → 409 with existing id; cancel is idempotent; re-request after cancel (T4)", async () => {
      const id = await h.createListing(owner);
      const body = { residencyId: id, requestedDate: await dayFromToday(7) };
      const first = await h.call("/user/visit-requests", { token: alice, body });
      assert.equal(first.status, 201);
      assert.match(first.body.message, /not a confirmed appointment/);
      const dup = await h.call("/user/visit-requests", { token: alice, body });
      assert.equal(dup.status, 409);
      assert.equal(dup.body.code, "DUPLICATE_REQUEST");
      assert.equal(dup.body.existingRequestId, first.body.visitRequest.id);

      const reqId = first.body.visitRequest.id;
      assert.equal((await h.call(`/user/visit-requests/${reqId}/cancel`, { token: bob })).status, 404, "someone else's request");
      const c1 = await h.call(`/user/visit-requests/${reqId}/cancel`, { token: alice });
      const c2 = await h.call(`/user/visit-requests/${reqId}/cancel`, { token: alice });
      assert.equal(c1.status, 200);
      assert.equal(c2.status, 200);
      assert.equal(c2.body.visitRequest.status, "CANCELLED");

      const again = await h.call("/user/visit-requests", { token: alice, body });
      assert.equal(again.status, 201);
      assert.equal((await h.prisma.visitRequest.findUnique({ where: { id: reqId } })).status, "CANCELLED");
    });

    test("expired requests (T7): shown as EXPIRED, don't block a new request, can't be cancelled", async () => {
      const id = await h.createListing(owner);
      const alUser = await h.prisma.user.findFirst({ where: { authId: `${h.run}-alice` } });
      // A pending request whose date has passed (inserted directly; the API never accepts past dates).
      const stale = await h.prisma.visitRequest.create({
        data: { requesterId: alUser.id, residencyId: id, requestedDate: new Date(`${await dayFromToday(-2)}T00:00:00Z`) },
      });
      const list = await h.call("/user/visit-requests", { method: "GET", token: alice });
      assert.equal(list.body.items.find((r) => r.id === stale.id).status, "EXPIRED");
      const cancel = await h.call(`/user/visit-requests/${stale.id}/cancel`, { token: alice });
      assert.equal(cancel.status, 409);
      assert.equal(cancel.body.code, "REQUEST_NOT_PENDING");

      // A second stale pending request is expired on create, so the new one succeeds.
      await h.prisma.visitRequest.create({
        data: { requesterId: alUser.id, residencyId: id, requestedDate: new Date(`${await dayFromToday(-1)}T00:00:00Z`) },
      });
      const fresh = await h.call("/user/visit-requests", { token: alice, body: { residencyId: id, requestedDate: await dayFromToday(3) } });
      assert.equal(fresh.status, 201);
    });

    test("owner sees requester name and date only; non-owners can't see the list", async () => {
      const id = await h.createListing(owner);
      await h.call("/user/register", { token: bob, body: { name: "Bob" } });
      await h.call("/user/visit-requests", { token: bob, body: { residencyId: id, requestedDate: await dayFromToday(8) } });
      const res = await h.call(`/user/listings/${id}/visit-requests`, { method: "GET", token: owner });
      assert.equal(res.status, 200);
      assert.equal(res.body.items.length, 1);
      assert.deepEqual(Object.keys(res.body.items[0]).sort(), ["createdAt", "id", "requestedDate", "requesterName", "status"]);
      assert.equal(res.body.items[0].requesterName, "Bob");
      assert.ok(!JSON.stringify(res.body).includes("@example.com"), "no email exposed");
      assert.equal((await h.call(`/user/listings/${id}/visit-requests`, { method: "GET", token: alice })).status, 404);
    });

    test("users only see their own visit requests", async () => {
      const id = await h.createListing(owner);
      const res = await h.call("/user/visit-requests", { token: alice, body: { residencyId: id, requestedDate: await dayFromToday(9) } });
      const bobs = await h.call("/user/visit-requests", { method: "GET", token: bob });
      assert.ok(!bobs.body.items.some((r) => r.id === res.body.visitRequest.id));
    });
  });
});

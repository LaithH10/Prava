// Concurrency and duplicate-submission tests (plan section 10, T1–T10, T12) against
// the real indexes in prava_test. Opt-in: RUN_DB_TESTS=1 yarn test
// T11 (missing index) is covered with fixtures in units.test.js; the real index is never dropped.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { RUN_DB_TESTS, createDbHarness, dayFromToday } from "./dbHarness.js";

const countBy = (results, key) =>
  results.reduce((acc, r) => ({ ...acc, [key(r)]: (acc[key(r)] ?? 0) + 1 }), {});

describe("concurrency", { skip: !RUN_DB_TESTS }, () => {
  let h;
  let owner;
  const users = [];

  before(async () => {
    h = await createDbHarness("conc");
    await h.start();
    owner = await h.token("owner");
    await h.call("/user/register", { token: owner });
    for (let i = 0; i < 10; i++) {
      const t = await h.token(`u${i}`);
      await h.call("/user/register", { token: t });
      users.push(t);
    }
  });
  after(() => h?.cleanup());

  const request = (token, residencyId, days = 5) =>
    dayFromToday(days).then((requestedDate) =>
      h.call("/user/visit-requests", { token, body: { residencyId, requestedDate } })
    );
  const pendingCount = (residencyId, requesterId) =>
    h.prisma.visitRequest.count({ where: { residencyId, status: "PENDING", ...(requesterId && { requesterId }) } });

  test("T1: 10 parallel identical visit requests → exactly one stored", async () => {
    const id = await h.createListing(owner);
    const results = await Promise.all(Array.from({ length: 10 }, () => request(users[0], id)));
    assert.deepEqual(countBy(results, (r) => `${r.status} ${r.body.code ?? ""}`.trim()), {
      201: 1,
      "409 DUPLICATE_REQUEST": 9,
    });
    assert.equal(await pendingCount(id), 1);
  });

  test("T2: two parallel cancels of the same request → both 200, one state change", async () => {
    const id = await h.createListing(owner);
    const created = await request(users[1], id);
    const reqId = created.body.visitRequest.id;
    const [a, b] = await Promise.all([
      h.call(`/user/visit-requests/${reqId}/cancel`, { token: users[1] }),
      h.call(`/user/visit-requests/${reqId}/cancel`, { token: users[1] }),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(a.body.visitRequest.closedAt, b.body.visitRequest.closedAt, "closedAt set once");
    assert.equal((await h.prisma.visitRequest.findUnique({ where: { id: reqId } })).status, "CANCELLED");
  });

  test("T3: cancel and new request racing, 20 rounds → never more than one PENDING", async () => {
    const id = await h.createListing(owner);
    const requester = await h.prisma.user.findFirst({ where: { authId: `${h.run}-u2` } });
    for (let round = 0; round < 20; round++) {
      let pending = await h.prisma.visitRequest.findFirst({
        where: { requesterId: requester.id, residencyId: id, status: "PENDING" },
      });
      if (!pending) pending = (await request(users[2], id)).body.visitRequest;
      const [cancel, create] = await Promise.all([
        h.call(`/user/visit-requests/${pending.id}/cancel`, { token: users[2] }),
        request(users[2], id),
      ]);
      assert.equal(cancel.status, 200, `round ${round} cancel: ${JSON.stringify(cancel.body)} (pending ${pending?.id})`);
      assert.ok(
        create.status === 201 || (create.status === 409 && create.body.code === "DUPLICATE_REQUEST"),
        `round ${round} create: ${create.status} ${create.body.code}`
      );
      assert.ok((await pendingCount(id, requester.id)) <= 1, `round ${round}: more than one PENDING`);
    }
  });

  test("T5 (critical): archive racing 10 new requests, 20 rounds → 0 PENDING on the archived listing", async () => {
    const outcomes = {};
    for (let round = 0; round < 20; round++) {
      const id = await h.createListing(owner);
      const [archive, ...requests] = await Promise.all([
        h.call(`/residency/${id}/archive`, { token: owner }),
        ...users.map((t) => request(t, id, 10)),
      ]);
      assert.equal(archive.status, 200, `round ${round} archive`);
      for (const r of requests) {
        const key = `${r.status} ${r.body.code ?? ""}`.trim();
        outcomes[key] = (outcomes[key] ?? 0) + 1;
        assert.ok(
          ["201", "409 LISTING_UNAVAILABLE", "404 NOT_FOUND"].includes(key),
          `round ${round}: unexpected ${key}`
        );
      }
      assert.equal(await pendingCount(id), 0, `round ${round}: PENDING request left on archived listing`);
      // Requests that got 201 before the archive finished must now be CLOSED.
      const created = requests.filter((r) => r.status === 201).map((r) => r.body.visitRequest.id);
      for (const reqId of created) {
        assert.equal((await h.prisma.visitRequest.findUnique({ where: { id: reqId } })).status, "CLOSED");
      }
    }
    // Record the mix of outcomes in the test output for the review.
    console.log("T5 outcomes over 200 racing requests:", JSON.stringify(outcomes));
  });

  test("T6: archive with pending requests, then restore → requests stay CLOSED; new request works", async () => {
    const id = await h.createListing(owner);
    const r1 = await request(users[3], id);
    await h.call(`/residency/${id}/archive`, { token: owner });
    await h.call(`/residency/${id}/restore`, { token: owner });
    assert.equal((await h.prisma.visitRequest.findUnique({ where: { id: r1.body.visitRequest.id } })).status, "CLOSED");
    assert.equal((await request(users[3], id)).status, 201);
  });

  test("T8: parallel favourite PUTs → one favourite; PUT/DELETE mixes never duplicate", async () => {
    const id = await h.createListing(owner);
    const puts = await Promise.all(Array.from({ length: 10 }, () => h.call(`/user/favourites/${id}`, { method: "PUT", token: users[4] })));
    assert.deepEqual(countBy(puts, (r) => r.status), { 200: 9, 201: 1 });
    const fav = await h.prisma.user.findFirst({ where: { authId: `${h.run}-u4` } });
    assert.equal(await h.prisma.favourite.count({ where: { userId: fav.id, residencyId: id } }), 1);

    for (let round = 0; round < 10; round++) {
      const mix = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          h.call(`/user/favourites/${id}`, { method: i % 2 ? "DELETE" : "PUT", token: users[4] })
        )
      );
      assert.ok(mix.every((r) => r.status === 200 || r.status === 201), `round ${round}`);
      assert.ok((await h.prisma.favourite.count({ where: { userId: fav.id, residencyId: id } })) <= 1);
    }
  });

  test("T9: 5 parallel identical listing creations → one listing", async () => {
    const body = h.property();
    const results = await Promise.all(Array.from({ length: 5 }, () => h.call("/residency/create", { token: owner, body })));
    assert.deepEqual(countBy(results, (r) => `${r.status} ${r.body.code ?? ""}`.trim()), {
      201: 1,
      "409 DUPLICATE_ADDRESS": 4,
    });
  });

  test("T10: parallel archive/restore → consistent final state; archived means no PENDING", async () => {
    const id = await h.createListing(owner);
    await request(users[5], id);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => h.call(`/residency/${id}/${i % 2 ? "restore" : "archive"}`, { token: owner }))
    );
    assert.ok(results.every((r) => r.status === 200));
    const final = await h.prisma.residency.findUnique({ where: { id } });
    assert.ok(["ACTIVE", "ARCHIVED"].includes(final.status));
    if (final.status === "ARCHIVED") assert.equal(await pendingCount(id), 0);
    // The archive in the mix closed the pending request in any case.
    assert.equal(await pendingCount(id), 0);
  });

  test("T12: non-owner edits/archives racing the owner's edit → always 404, owner's edit wins", async () => {
    const id = await h.createListing(owner);
    const results = await Promise.all([
      h.call(`/residency/${id}`, { method: "PATCH", token: owner, body: { title: "Owner title" } }),
      ...users.slice(0, 5).map((t) => h.call(`/residency/${id}`, { method: "PATCH", token: t, body: { title: "Hijacked" } })),
      ...users.slice(5).map((t) => h.call(`/residency/${id}/archive`, { token: t })),
    ]);
    assert.equal(results[0].status, 200);
    assert.ok(results.slice(1).every((r) => r.status === 404));
    const final = await h.prisma.residency.findUnique({ where: { id } });
    assert.equal(final.title, "Owner title");
    assert.equal(final.status, "ACTIVE");
  });
});

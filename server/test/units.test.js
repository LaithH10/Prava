// Pure unit tests: dates, validation schemas and the partial-index check.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { checkRequestedDay, todayInAmsterdam } from "../utils/dates.js";
import { PENDING_INDEX, verifyPendingIndex } from "../config/indexes.js";
import { createResidencySchema, updateResidencySchema } from "../validation/schemas.js";

describe("visit-request dates (Europe/Amsterdam)", () => {
  // 2026-10-16 23:30 UTC is already 2026-10-17 in Amsterdam (UTC+2).
  const lateEvening = new Date("2026-10-16T23:30:00Z");

  test("uses the Amsterdam calendar day", () => {
    assert.equal(todayInAmsterdam(lateEvening), "2026-10-17");
  });

  test("tomorrow up to 90 days ahead is allowed", () => {
    assert.equal(checkRequestedDay("2026-10-18", lateEvening), null);
    assert.equal(checkRequestedDay("2027-01-15", lateEvening), null); // 90 days after 2026-10-17
  });

  test("today, the past and more than 90 days ahead are refused", () => {
    assert.match(checkRequestedDay("2026-10-17", lateEvening), /tomorrow/);
    assert.match(checkRequestedDay("2026-10-01", lateEvening), /tomorrow/);
    assert.match(checkRequestedDay("2027-01-16", lateEvening), /90 days/);
  });

  test("impossible dates are refused", () => {
    assert.match(checkRequestedDay("2026-02-30", lateEvening), /valid date/);
  });
});

describe("residency validation", () => {
  const valid = {
    title: "Nice house",
    description: "A lovely place to live.",
    price: 250000,
    address: "Straat 1",
    city: "Utrecht",
    country: "Netherlands",
    image: "https://example.com/a.jpg",
    facilities: { bedrooms: 2, bathrooms: 1, parkings: 0 },
  };

  test("strips identity and status fields from the body", () => {
    const parsed = createResidencySchema.parse({ ...valid, ownerId: "x", status: "ARCHIVED", userEmail: "e" });
    assert.equal("ownerId" in parsed, false);
    assert.equal("status" in parsed, false);
    assert.equal("userEmail" in parsed, false);
  });

  test("rejects http images, non-integer prices and unknown facility keys", () => {
    assert.equal(createResidencySchema.safeParse({ ...valid, image: "http://example.com/a.jpg" }).success, false);
    assert.equal(createResidencySchema.safeParse({ ...valid, image: "javascript:alert(1)" }).success, false);
    assert.equal(createResidencySchema.safeParse({ ...valid, price: 10.5 }).success, false);
    assert.equal(createResidencySchema.safeParse({ ...valid, facilities: { ...valid.facilities, pool: 1 } }).success, false);
  });

  test("an update needs at least one field", () => {
    assert.equal(updateResidencySchema.safeParse({}).success, false);
    assert.equal(updateResidencySchema.safeParse({ price: 300000 }).success, true);
  });
});

describe("regex escaping (Prisma passes contains/startsWith to $regex unescaped)", () => {
  test("escapes every regex metacharacter", async () => {
    const { escapeRegex } = await import("../utils/regex.js");
    const tricky = "a.c*+?^${}()|[]\\";
    assert.equal(new RegExp(`^${escapeRegex(tricky)}$`).test(tricky), true);
    assert.equal(new RegExp(escapeRegex("a.c")).test("abc"), false);
    assert.equal(new RegExp(escapeRegex("test|x")).test("test-other"), false);
  });
});

describe("partial index verification (T11, fixtures only; the real index is never dropped)", () => {
  const idIndex = { name: "_id_", key: { _id: 1 } };
  const good = { name: PENDING_INDEX.name, key: { requesterId: 1, residencyId: 1 }, unique: true, partialFilterExpression: { status: "PENDING" } };

  test("passes for the correct index", () => {
    assert.ok(verifyPendingIndex([idIndex, good]));
  });

  test("fails loudly when the index is missing", () => {
    assert.throws(() => verifyPendingIndex([idIndex]), /Missing index "visit_request_one_pending"/);
    assert.throws(() => verifyPendingIndex(undefined), /Missing index/);
  });

  test("fails when the index exists with the wrong options", () => {
    assert.throws(() => verifyPendingIndex([{ ...good, unique: false }]), /wrong options: unique/);
    assert.throws(() => verifyPendingIndex([{ ...good, partialFilterExpression: undefined }]), /partialFilterExpression/);
    assert.throws(() => verifyPendingIndex([{ ...good, key: { residencyId: 1 } }]), /key/);
  });
});

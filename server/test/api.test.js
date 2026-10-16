// API and auth tests that need no database. Run with `yarn test` from server/.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";

// This file never uses a database, even when RUN_DB_TESTS=1 is set for db.test.js.
delete process.env.RUN_DB_TESTS;
const { AUDIENCE, ISSUER, otherKeyPair, signToken } = await import("./helpers.js");

const { createApp } = await import("../app.js");
const { prisma } = await import("../config/prismaConfig.js");

const listen = async (app) => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}/api` };
};

let server;
let base;

before(async () => {
  ({ server, base } = await listen(createApp()));
});

after(async () => {
  server.close();
  await prisma.$disconnect();
});

const call = (path, { method = "POST", token, body, root = base } = {}) =>
  fetch(root + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

const RID = "507f1f77bcf86cd799439011";
const PROTECTED = [
  ["POST", "/user/register"],
  ["GET", "/user/listings"],
  ["GET", `/user/listings/${RID}/visit-requests`],
  ["GET", "/user/favourites"],
  ["PUT", `/user/favourites/${RID}`],
  ["DELETE", `/user/favourites/${RID}`],
  ["GET", "/user/visit-requests"],
  ["POST", "/user/visit-requests"],
  ["POST", `/user/visit-requests/${RID}/cancel`],
  ["POST", "/residency/create"],
  ["PATCH", `/residency/${RID}`],
  ["POST", `/residency/${RID}/archive`],
  ["POST", `/residency/${RID}/restore`],
];

describe("general behaviour and error format", () => {
  test("unknown route returns JSON 404 with code", async () => {
    const res = await fetch(base + "/nope");
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { message: "Not found", code: "NOT_FOUND" });
  });

  test("malformed property id returns 400 VALIDATION_ERROR (public route, no token)", async () => {
    const res = await fetch(base + "/residency/notanid");
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { message: "Invalid residency id", code: "VALIDATION_ERROR" });
  });

  test("malformed JSON body returns 400 VALIDATION_ERROR", async () => {
    const res = await call("/user/register", { body: "{bad json" });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { message: "Invalid JSON body", code: "VALIDATION_ERROR" });
  });

  test("bodies over 20kb return 413 PAYLOAD_TOO_LARGE", async () => {
    const res = await call("/residency/create", { body: { description: "x".repeat(25_000) } });
    assert.equal(res.status, 413);
    assert.equal((await res.json()).code, "PAYLOAD_TOO_LARGE");
  });

  test("invalid list query returns 400 with field messages", async () => {
    const res = await fetch(base + "/residency/allresd?limit=500&cursor=nope");
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, "VALIDATION_ERROR");
    assert.ok(body.fields.limit && body.fields.cursor);
  });

  test("public listing route needs no token (fails only on the database)", async () => {
    const res = await fetch(base + "/residency/allresd");
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { message: "Something went wrong", code: "INTERNAL" });
  });

  test("helmet sets security headers", async () => {
    const res = await fetch(base + "/nope");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.ok(res.headers.get("content-security-policy"));
    assert.equal(res.headers.get("x-powered-by"), null);
  });

  test("CORS allows the configured origin only", async () => {
    const ok = await fetch(base + "/nope", { headers: { Origin: "http://localhost:5173" } });
    assert.equal(ok.headers.get("access-control-allow-origin"), "http://localhost:5173");
    const blocked = await fetch(base + "/nope", { headers: { Origin: "https://evil.example" } });
    assert.equal(blocked.headers.get("access-control-allow-origin"), null);
  });
});

describe("rate limiting", () => {
  test("writes over the limit return 429 RATE_LIMITED; reads have their own limit", async () => {
    const limited = await listen(createApp({ rateLimits: { writesPerMinute: 3, readsPerMinute: 100 } }));
    try {
      const statuses = [];
      for (let i = 0; i < 4; i++) {
        statuses.push((await call("/user/register", { root: limited.base })).status);
      }
      assert.deepEqual(statuses, [401, 401, 401, 429]);
      const res = await call("/user/register", { root: limited.base });
      assert.deepEqual(await res.json(), {
        message: "Too many requests. Please wait a minute and try again.",
        code: "RATE_LIMITED",
      });
      // Reads are counted separately and still allowed.
      assert.equal((await fetch(limited.base + "/nope")).status, 404);
    } finally {
      limited.server.close();
    }
  });
});

describe("authentication (401)", () => {
  for (const [method, path] of PROTECTED) {
    test(`${method} ${path} without a token`, async () => {
      const res = await call(path, { method });
      assert.equal(res.status, 401);
      assert.equal((await res.json()).code, "UNAUTHENTICATED");
    });
  }

  test("email in the body does not authenticate", async () => {
    const res = await call("/user/visit-requests", {
      body: { email: "someone@example.com", residencyId: RID, requestedDate: "2030-01-01" },
    });
    assert.equal(res.status, 401);
  });

  const badTokens = {
    "malformed token": async () => "not-a-jwt",
    "token signed by another key": async () =>
      signToken({ sub: "auth0|a", key: (await otherKeyPair()).privateKey }),
    "expired token": async () => signToken({ sub: "auth0|a", expiresIn: Math.floor(Date.now() / 1000) - 120 }),
    "wrong issuer": async () => signToken({ sub: "auth0|a", issuer: "https://evil.example/" }),
    "wrong audience": async () => signToken({ sub: "auth0|a", audience: "https://other.api" }),
    "HS256 token (algorithm confusion)": async () =>
      new SignJWT({ sub: "auth0|a" })
        .setProtectedHeader({ alg: "HS256", kid: "test-key" })
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setExpirationTime("5m")
        .sign(new TextEncoder().encode("a-guessable-shared-secret-of-32-bytes!")),
    "unsigned token (alg none)": async () => {
      const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const exp = Math.floor(Date.now() / 1000) + 300;
      return `${enc({ alg: "none" })}.${enc({ sub: "auth0|a", iss: ISSUER, aud: AUDIENCE, exp })}.`;
    },
  };
  for (const [name, makeToken] of Object.entries(badTokens)) {
    test(`rejects ${name}`, async () => {
      const res = await call("/user/visit-requests", { method: "GET", token: await makeToken() });
      assert.equal(res.status, 401);
      assert.equal((await res.json()).code, "UNAUTHENTICATED");
    });
  }

  test("an invalid token is rejected on the optional-auth detail route too", async () => {
    const res = await call(`/residency/${RID}`, { method: "GET", token: "not-a-jwt" });
    assert.equal(res.status, 401);
  });

  test("accepts a valid RS256 token (then needs the database)", async () => {
    const token = await signToken({ sub: "auth0|valid" });
    const res = await call("/user/visit-requests", { method: "GET", token });
    // No database is reachable here, so loading the user fails after authentication.
    assert.equal(res.status, 500);
  });
});

describe("verified email (403 EMAIL_NOT_VERIFIED)", () => {
  test("unverified email cannot create a property", async () => {
    const token = await signToken({ sub: "auth0|unverified", emailVerified: false });
    const res = await call("/residency/create", { token, body: { title: "x" } });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, "EMAIL_NOT_VERIFIED");
  });

  test("unverified email cannot send a visit request", async () => {
    const token = await signToken({ sub: "auth0|unverified", emailVerified: false });
    const res = await call("/user/visit-requests", { token, body: { residencyId: RID, requestedDate: "2030-01-01" } });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, "EMAIL_NOT_VERIFIED");
  });
});

describe("old milestone 1/2 routes are gone", () => {
  for (const [method, path] of [
    ["POST", `/user/bookVisit/${RID}`],
    ["POST", `/user/removeBooking/${RID}`],
    ["POST", `/user/toFav/${RID}`],
    ["GET", "/user/bookings"],
  ]) {
    test(`${method} ${path} no longer exists`, async () => {
      const token = await signToken({ sub: "auth0|valid" });
      const res = await call(path, { method, token });
      assert.equal(res.status, 404);
    });
  }
});

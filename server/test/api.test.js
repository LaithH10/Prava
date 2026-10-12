// API and auth tests that need no database. Run with `yarn test` from server/.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";

// This file never uses a database, even when RUN_DB_TESTS=1 is set for db.test.js.
delete process.env.RUN_DB_TESTS;
const { AUDIENCE, ISSUER, otherKeyPair, signToken } = await import("./helpers.js");

const { createApp } = await import("../app.js");
const { prisma } = await import("../config/prismaConfig.js");

let server;
let base;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  server.close();
  await prisma.$disconnect();
});

const call = (path, { method = "POST", token, body } = {}) =>
  fetch(base + path, {
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
  ["POST", `/user/bookVisit/${RID}`],
  ["GET", "/user/bookings"],
  ["POST", `/user/removeBooking/${RID}`],
  ["POST", `/user/toFav/${RID}`],
  ["GET", "/user/favourites"],
  ["POST", "/residency/create"],
];

describe("general behaviour", () => {
  test("unknown route returns JSON 404", async () => {
    const res = await fetch(base + "/nope");
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { message: "Not found" });
  });

  test("malformed property id returns 400 (public route, no token)", async () => {
    const res = await fetch(base + "/residency/notanid");
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { message: "Invalid residency id" });
  });

  test("malformed JSON body returns 400", async () => {
    const res = await call("/user/register", { body: "{bad json" });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { message: "Invalid JSON body" });
  });

  test("public listing route needs no token (fails only on the database)", async () => {
    const res = await fetch(base + "/residency/allresd");
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { message: "Something went wrong" });
  });

  test("CORS allows the configured origin only", async () => {
    const ok = await fetch(base + "/nope", { headers: { Origin: "http://localhost:5173" } });
    assert.equal(ok.headers.get("access-control-allow-origin"), "http://localhost:5173");
    const blocked = await fetch(base + "/nope", { headers: { Origin: "https://evil.example" } });
    assert.equal(blocked.headers.get("access-control-allow-origin"), null);
  });
});

describe("authentication (401)", () => {
  for (const [method, path] of PROTECTED) {
    test(`${method} ${path} without a token`, async () => {
      const res = await call(path, { method });
      assert.equal(res.status, 401);
    });
  }

  test("email in the body does not authenticate", async () => {
    const res = await call(`/user/bookVisit/${RID}`, {
      body: { email: "someone@example.com", date: "2026-11-01" },
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
      const res = await call("/user/bookings", { method: "GET", token: await makeToken() });
      assert.equal(res.status, 401);
    });
  }

  test("accepts a valid RS256 token (then needs the database)", async () => {
    const token = await signToken({ sub: "auth0|valid" });
    const res = await call("/user/bookings", { method: "GET", token });
    // No database is reachable here, so loading the user fails after authentication.
    assert.equal(res.status, 500);
  });
});

describe("verified email (403)", () => {
  test("unverified email cannot create a property", async () => {
    const token = await signToken({ sub: "auth0|unverified", emailVerified: false });
    const res = await call("/residency/create", { token, body: { title: "x" } });
    assert.equal(res.status, 403);
  });

  test("unverified email cannot book a visit", async () => {
    const token = await signToken({ sub: "auth0|unverified", emailVerified: false });
    const res = await call(`/user/bookVisit/${RID}`, { token, body: { date: "2026-11-01" } });
    assert.equal(res.status, 403);
  });
});

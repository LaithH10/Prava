// API tests using Node's built-in test runner: `yarn test` (from server/).
//
// The first group needs no database. The second group runs only with RUN_DB_TESTS=1.
// It uses TEST_DATABASE_URL from server/.env.test: a dedicated test user whose only
// permission is the test database. It never reads the app's DATABASE_URL credentials,
// and it removes only the records it created.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import dotenv from "dotenv";

const RUN_DB_TESTS = process.env.RUN_DB_TESTS === "1";

// Refuses to run unless the test database is clearly separate from the app database.
const useTestDatabase = () => {
  const readEnv = (file) => {
    const path = new URL(file, import.meta.url);
    return fs.existsSync(path) ? dotenv.parse(fs.readFileSync(path)) : {};
  };
  const testUrl = readEnv("../.env.test").TEST_DATABASE_URL;
  if (!testUrl) throw new Error("RUN_DB_TESTS=1 needs TEST_DATABASE_URL in server/.env.test");

  const test = new URL(testUrl);
  const testDb = test.pathname.slice(1);
  if (!testDb.endsWith("_test")) {
    throw new Error(`Test database name must end in "_test" (got "${testDb}")`);
  }

  const appUrl = readEnv("../.env").DATABASE_URL;
  if (appUrl) {
    const app = new URL(appUrl);
    if (app.username === test.username) {
      throw new Error("Test user must differ from the app's database user");
    }
    if (app.host === test.host && app.pathname === test.pathname) {
      throw new Error("Test database must differ from the app database");
    }
  }
  process.env.DATABASE_URL = testUrl;
};

if (RUN_DB_TESTS) {
  useTestDatabase();
} else {
  // Unreachable on purpose: these tests must fail before touching a database.
  process.env.DATABASE_URL = "mongodb://127.0.0.1:1/unreachable?serverSelectionTimeoutMS=2000&connectTimeoutMS=2000";
}
process.env.CORS_ORIGIN = "http://localhost:5173";

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

const post = (path, body) =>
  fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("without a database", () => {
  test("unknown route returns JSON 404", async () => {
    const res = await fetch(base + "/nope");
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { message: "Not found" });
  });

  test("malformed property id returns 400", async () => {
    const res = await fetch(base + "/residency/notanid");
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { message: "Invalid residency id" });
  });

  test("malformed JSON body returns 400", async () => {
    const res = await fetch(base + "/user/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad json",
    });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { message: "Invalid JSON body" });
  });

  const missingEmail = [
    ["/user/register", {}],
    ["/user/bookVisit/507f1f77bcf86cd799439011", { date: "2026-11-01" }],
    ["/user/allBookings", {}],
    ["/user/removeBooking/507f1f77bcf86cd799439011", {}],
    ["/user/toFav/507f1f77bcf86cd799439011", {}],
    ["/user/allFav", {}],
    ["/residency/create", { title: "x" }],
  ];
  for (const [path, body] of missingEmail) {
    test(`${path} without a valid email returns 400`, async () => {
      const res = await post(path, body);
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { message: "A valid email is required" });
    });
  }

  for (const path of ["/user/bookVisit/bad", "/user/removeBooking/bad", "/user/toFav/bad"]) {
    test(`${path} with a malformed id returns 400`, async () => {
      const res = await post(path, { email: "a@example.com" });
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { message: "Invalid residency id" });
    });
  }

  test("database failure returns generic 500 without details", async () => {
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

describe("with the prava_test database", { skip: !RUN_DB_TESTS }, () => {
  const email = `test-${Date.now()}@example.com`;
  const property = {
    title: "Test house",
    description: "Created by the API tests",
    price: 250000,
    address: `Teststraat ${Date.now()}`,
    city: "Utrecht",
    country: "Netherlands",
    image: "https://example.com/house.jpg",
    facilities: { bedrooms: 3, bathrooms: 1, parkings: 1 },
    userEmail: email,
  };
  let residencyId;

  after(async () => {
    // Remove only what these tests created.
    await prisma.residency.deleteMany({ where: { userEmail: email } });
    await prisma.user.deleteMany({ where: { email } });
  });

  test("register a user", async () => {
    const res = await post("/user/register", { email, name: "Test" });
    assert.equal(res.status, 200);
  });

  test("create a property", async () => {
    const res = await post("/residency/create", property);
    assert.equal(res.status, 200);
    residencyId = (await res.json()).residency.id;
  });

  test("duplicate property returns 409", async () => {
    const res = await post("/residency/create", property);
    assert.equal(res.status, 409);
  });

  test("property for an unknown owner returns 404", async () => {
    const res = await post("/residency/create", {
      ...property,
      userEmail: "nobody-" + email,
    });
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { message: "Owner not found" });
  });

  test("property with missing fields returns 400", async () => {
    const res = await post("/residency/create", { userEmail: email });
    assert.equal(res.status, 400);
  });

  test("get the property, and 404 for a valid but unknown id", async () => {
    assert.equal((await fetch(`${base}/residency/${residencyId}`)).status, 200);
    const res = await fetch(base + "/residency/507f1f77bcf86cd799439011");
    assert.equal(res.status, 404);
  });

  test("book a visit, then a duplicate booking returns 400", async () => {
    const path = `/user/bookVisit/${residencyId}`;
    assert.equal((await post(path, { email, date: "2026-11-01" })).status, 200);
    assert.equal((await post(path, { email, date: "2026-11-02" })).status, 400);
  });

  test("cancel the booking, then cancelling again returns 404", async () => {
    const path = `/user/removeBooking/${residencyId}`;
    assert.equal((await post(path, { email })).status, 200);
    assert.equal((await post(path, { email })).status, 404);
  });

  test("toggle a favourite on and off", async () => {
    const path = `/user/toFav/${residencyId}`;
    assert.equal((await (await post(path, { email })).json()).message, "Updated favourites");
    assert.equal((await (await post(path, { email })).json()).message, "Removed from favourites");
  });

  test("unknown user returns 404 on user endpoints", async () => {
    const other = "nobody-" + email;
    assert.equal((await post(`/user/bookVisit/${residencyId}`, { email: other })).status, 404);
    assert.equal((await post("/user/allBookings", { email: other })).status, 404);
    assert.equal((await post(`/user/toFav/${residencyId}`, { email: other })).status, 404);
    assert.equal((await post("/user/allFav", { email: other })).status, 404);
  });
});

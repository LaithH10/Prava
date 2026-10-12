// Shared test setup. Import this before the app: it sets env vars that app.js reads.
//
// Auth: a local JWKS server on 127.0.0.1 serves a freshly generated RSA public key,
// and signToken() signs real RS256 tokens with the matching private key. The app's
// production verification code runs unchanged; it never contacts Auth0.
//
// Database: without RUN_DB_TESTS=1 the database URL is unreachable on purpose.
// With it, TEST_DATABASE_URL from server/.env.test is used after safety checks.
import http from "node:http";
import fs from "node:fs";
import dotenv from "dotenv";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

export const RUN_DB_TESTS = process.env.RUN_DB_TESTS === "1";
export const AUDIENCE = "https://api.prava";
export const EMAIL_CLAIM = "https://prava/email";
export const EMAIL_VERIFIED_CLAIM = "https://prava/email_verified";

// --- Auth: local JWKS + token signing -------------------------------------
const KID = "test-key";
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: KID, alg: "RS256", use: "sig" }] };

const jwksServer = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(jwks));
});
await new Promise((resolve) => jwksServer.listen(0, "127.0.0.1", resolve));
jwksServer.unref();

export const ISSUER = `http://127.0.0.1:${jwksServer.address().port}/`;
process.env.AUTH0_ISSUER = ISSUER;
process.env.AUTH0_JWKS_URI = `${ISSUER}.well-known/jwks.json`;
process.env.AUTH0_AUDIENCE = AUDIENCE;
process.env.CORS_ORIGIN = "http://localhost:5173";

// Signs an RS256 access token. `overrides` can change any claim or the key.
export const signToken = async ({
  sub,
  email = `${sub}@example.com`,
  emailVerified = true,
  issuer = ISSUER,
  audience = AUDIENCE,
  expiresIn = "5m",
  key = privateKey,
  alg = "RS256",
} = {}) => {
  const jwt = new SignJWT({ [EMAIL_CLAIM]: email, [EMAIL_VERIFIED_CLAIM]: emailVerified })
    .setProtectedHeader({ alg, kid: KID })
    .setIssuedAt(Math.floor(Date.now() / 1000) - 600)
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime(expiresIn);
  if (sub) jwt.setSubject(sub);
  return jwt.sign(key);
};

export const otherKeyPair = () => generateKeyPair("RS256");

// --- Database --------------------------------------------------------------
const readEnv = (file) => {
  const path = new URL(file, import.meta.url);
  return fs.existsSync(path) ? dotenv.parse(fs.readFileSync(path)) : {};
};

// Refuses any URL that isn't clearly a separate test database and user.
const useTestDatabaseUrl = () => {
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
  return testDb;
};

export const TEST_DB = RUN_DB_TESTS ? useTestDatabaseUrl() : null;
if (!RUN_DB_TESTS) {
  // Unreachable on purpose: tests without RUN_DB_TESTS must never touch a database.
  process.env.DATABASE_URL =
    "mongodb://127.0.0.1:1/unreachable?serverSelectionTimeoutMS=2000&connectTimeoutMS=2000";
}

// Checks the live connection before any test writes or deletes anything:
// it must be on the test database, and the user may hold only read/readWrite
// roles on that database (no readWriteAnyDatabase, admin or other databases).
export const assertIsolatedTestDatabase = async (prisma) => {
  const stats = await prisma.$runCommandRaw({ dbStats: 1 });
  if (stats.db !== TEST_DB) {
    throw new Error(`Connected to "${stats.db}", expected "${TEST_DB}"`);
  }

  const status = await prisma.$runCommandRaw({ connectionStatus: 1 });
  const roles = status.authInfo?.authenticatedUserRoles ?? [];
  if (roles.length === 0) throw new Error("Could not read the test user's roles");
  const tooBroad = roles.filter(
    ({ role, db }) => db !== TEST_DB || !["read", "readWrite"].includes(role)
  );
  if (tooBroad.length) {
    const list = tooBroad.map(({ role, db }) => `${role}@${db}`).join(", ");
    throw new Error(`Test user has permissions beyond ${TEST_DB}: ${list}`);
  }
};

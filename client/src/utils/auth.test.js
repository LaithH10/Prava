import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NotLoggedInError,
  SessionExpiredError,
  TemporaryAuthError,
  classifyApiError,
  classifyRenewalError,
  getAccessToken,
  needsToken,
  setTokenGetter,
} from "./auth.js";

test("only protected routes need a token", () => {
  assert.equal(needsToken({ url: "/user/bookings", method: "get" }), true);
  assert.equal(needsToken({ url: "/residency/create", method: "post" }), true);
  assert.equal(needsToken({ url: "/residency/allresd", method: "get" }), false);
  assert.equal(needsToken({ url: "/residency/abc", method: "get" }), false);
});

test("permanent renewal failures end the session", () => {
  for (const code of ["login_required", "consent_required", "invalid_grant", "missing_refresh_token"]) {
    assert.ok(classifyRenewalError({ error: code }) instanceof SessionExpiredError, code);
  }
});

test("temporary renewal failures keep the session", () => {
  assert.ok(classifyRenewalError({ error: "timeout" }) instanceof TemporaryAuthError);
  assert.ok(classifyRenewalError(new TypeError("Failed to fetch")) instanceof TemporaryAuthError);
  assert.ok(classifyRenewalError(undefined) instanceof TemporaryAuthError);
});

test("getAccessToken: not logged in, permanent and temporary failures", async () => {
  setTokenGetter(null);
  await assert.rejects(getAccessToken(), NotLoggedInError);

  setTokenGetter(async () => { throw { error: "invalid_grant" }; });
  await assert.rejects(getAccessToken(), SessionExpiredError);

  setTokenGetter(async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(getAccessToken(), TemporaryAuthError);

  setTokenGetter(async () => "token");
  assert.equal(await getAccessToken(), "token");
  setTokenGetter(null);
});

test("a 401 only ends the session for protected requests", () => {
  const response = { status: 401 };
  assert.equal(classifyApiError({ response, config: { url: "/user/bookings", method: "get" } }), "sessionExpired");
  assert.equal(classifyApiError({ response, config: { url: "/residency/allresd", method: "get" } }), "other");
  assert.equal(classifyApiError({ response, config: undefined }), "other");
});

test("other errors are classified without ending the session", () => {
  assert.equal(classifyApiError(new NotLoggedInError()), "notLoggedIn");
  assert.equal(classifyApiError(new SessionExpiredError()), "sessionExpired");
  assert.equal(classifyApiError(new TemporaryAuthError()), "temporary");
  assert.equal(classifyApiError({ response: { status: 403 }, config: { url: "/user/bookVisit/x", method: "post" } }), "forbidden");
  assert.equal(classifyApiError({ response: { status: 500 }, config: { url: "/user/bookings", method: "get" } }), "other");
  assert.equal(classifyApiError({ message: "Network Error", config: { url: "/user/bookings", method: "get" } }), "other");
});

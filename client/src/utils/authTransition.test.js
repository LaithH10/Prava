import { test } from "node:test";
import assert from "node:assert/strict";
import { authTransition, initialAuthState } from "./authTransition.js";

const loading = { isLoading: true, isAuthenticated: false, sub: undefined };
const loggedOut = { isLoading: false, isAuthenticated: false, sub: undefined };
const as = (sub) => ({ isLoading: false, isAuthenticated: true, sub });

// Runs a sequence of SDK states and collects the decisions.
const run = (...states) => {
  let state = initialAuthState;
  return states.map((auth) => {
    const { next, syncProfile, clearUserData } = authTransition(state, auth);
    state = next;
    return { syncProfile, clearUserData };
  });
};

test("does nothing while the SDK is initialising", () => {
  assert.deepEqual(run(loading), [{ syncProfile: false, clearUserData: false }]);
});

test("syncs the profile once per login, not on every render", () => {
  const steps = run(loading, as("auth0|a"), as("auth0|a"), as("auth0|a"));
  assert.deepEqual(steps.map((s) => s.syncProfile), [false, true, false, false]);
});

test("regression: logging out and back in with the same account syncs again", () => {
  const steps = run(loading, as("auth0|a"), loggedOut, as("auth0|a"));
  assert.deepEqual(steps.map((s) => s.syncProfile), [false, true, false, true]);
});

test("switching users syncs the new user", () => {
  const steps = run(loading, as("auth0|a"), as("google-oauth2|b"));
  assert.deepEqual(steps.map((s) => s.syncProfile), [false, true, true]);
});

test("clears user data on logout and on a user switch, not on first load", () => {
  const steps = run(loading, as("auth0|a"), as("google-oauth2|b"), loggedOut, as("auth0|a"));
  assert.deepEqual(steps.map((s) => s.clearUserData), [false, false, true, true, true]);
});

test("does not clear data when the initial state is logged out", () => {
  const steps = run(loading, loggedOut, loggedOut);
  assert.deepEqual(steps.map((s) => s.clearUserData), [false, false, false]);
});

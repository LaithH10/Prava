// Bridge between the Auth0 React SDK (hooks) and the plain axios module in api.js,
// plus the rules for which requests carry a token and how errors are classified.
// No React or browser imports here, so the rules can be unit-tested with node:test.

let tokenGetter = null;
let sessionExpiredHandler = null;

export class NotLoggedInError extends Error {}
// The session can't be renewed (e.g. refresh token revoked or expired): log in again.
export class SessionExpiredError extends Error {}
// Renewal failed for a reason that may pass (network, timeout): keep the session.
export class TemporaryAuthError extends Error {}

// Auth0 error codes that mean the session is really over and only a new login helps.
const PERMANENT_RENEWAL_ERRORS = new Set([
  "login_required",
  "consent_required",
  "interaction_required",
  "invalid_grant",
  "missing_refresh_token",
  "access_denied",
  "unauthorized",
]);

export const setTokenGetter = (getter) => {
  tokenGetter = getter;
};

export const setSessionExpiredHandler = (handler) => {
  sessionExpiredHandler = handler;
};

// Turns an error from the SDK's getAccessTokenSilently into one of our error types.
export const classifyRenewalError = (err) => {
  const code = err?.error;
  if (PERMANENT_RENEWAL_ERRORS.has(code)) {
    return new SessionExpiredError(code);
  }
  // timeout, network failures ("Failed to fetch"), unknown errors
  return new TemporaryAuthError(code || err?.message || "Token renewal failed");
};

// Returns an access token for the Prava API. Throws instead of returning nothing,
// so a protected request is never sent without a token.
export const getAccessToken = async () => {
  if (!tokenGetter) throw new NotLoggedInError("Please log in first");
  try {
    return await tokenGetter();
  } catch (err) {
    throw classifyRenewalError(err);
  }
};

export const handleSessionExpired = () => {
  sessionExpiredHandler?.();
};

// Only these calls carry a token; public listing and detail calls never do.
export const needsToken = ({ url = "", method = "get" } = {}) =>
  url.startsWith("/user/") ||
  (method.toLowerCase() === "post" && url === "/residency/create");

// Decides how the UI reacts to a failed API call:
// "notLoggedIn" | "sessionExpired" | "temporary" | "forbidden" | "other".
// A 401 only ends the session when it came from a protected request.
export const classifyApiError = (error) => {
  if (error instanceof NotLoggedInError) return "notLoggedIn";
  if (error instanceof SessionExpiredError) return "sessionExpired";
  if (error instanceof TemporaryAuthError) return "temporary";
  const status = error?.response?.status;
  if (status === 401 && needsToken(error.config)) return "sessionExpired";
  if (status === 403 && needsToken(error.config)) return "forbidden";
  return "other";
};

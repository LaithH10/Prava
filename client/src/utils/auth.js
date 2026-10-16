// Bridge between the Auth0 React SDK (hooks) and the plain axios module in api.js.
// AuthSync registers the SDK's functions here once Auth0 has finished initialising.

let tokenGetter = null;
let sessionExpiredHandler = null;

export class NotLoggedInError extends Error {}
export class SessionExpiredError extends Error {}

export const setTokenGetter = (getter) => {
  tokenGetter = getter;
};

export const setSessionExpiredHandler = (handler) => {
  sessionExpiredHandler = handler;
};

// Returns an access token for the Prava API. Throws instead of returning nothing,
// so a protected request is never sent without a token.
export const getAccessToken = async () => {
  if (!tokenGetter) throw new NotLoggedInError("Please log in first");
  try {
    return await tokenGetter();
  } catch (err) {
    // login_required, missing_refresh_token, invalid_grant, network errors, ...
    throw new SessionExpiredError(err?.error || err?.message || "Session expired");
  }
};

export const handleSessionExpired = () => {
  sessionExpiredHandler?.();
};

// Pure decision logic for AuthSync, kept free of React so it can be unit-tested.
//
// `prev` is what AuthSync remembers: { identity, syncedSub }.
//   identity: undefined (SDK not initialised yet), null (logged out) or the user's sub.
//   syncedSub: the sub whose profile was synced during the current login, or null.
// `auth` is the SDK state: { isLoading, isAuthenticated, sub }.
//
// Returns { next, syncProfile, clearUserData }.
export const authTransition = (prev, { isLoading, isAuthenticated, sub }) => {
  if (isLoading) {
    return { next: prev, syncProfile: false, clearUserData: false };
  }

  const identity = isAuthenticated && sub ? sub : null;

  // User-specific cached data must not survive a logout or a switch to another user.
  const clearUserData = prev.identity !== undefined && prev.identity !== identity;

  if (!identity) {
    // Logged out: forget the sync, so the next login of the same account syncs again.
    return { next: { identity: null, syncedSub: null }, syncProfile: false, clearUserData };
  }

  const syncProfile = prev.syncedSub !== identity;
  return { next: { identity, syncedSub: identity }, syncProfile, clearUserData };
};

export const initialAuthState = { identity: undefined, syncedSub: null };

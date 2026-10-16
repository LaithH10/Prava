import { useEffect, useRef } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { useQueryClient } from "react-query";
import { registerUser } from "../../utils/api";
import { setSessionExpiredHandler, setTokenGetter } from "../../utils/auth";
import { authTransition, initialAuthState } from "../../utils/authTransition";

// User-specific React Query keys start with this prefix, e.g. ["user", "bookings"].
export const USER_QUERY_PREFIX = "user";

// Connects Auth0 to the API layer and the query cache. Renders nothing.
// Nothing happens until the SDK has finished initialising (isLoading false).
const AuthSync = () => {
  const { isLoading, isAuthenticated, user, getAccessTokenSilently, logout } =
    useAuth0();
  const queryClient = useQueryClient();
  const state = useRef(initialAuthState);

  useEffect(() => {
    setTokenGetter(
      !isLoading && isAuthenticated ? () => getAccessTokenSilently() : null
    );
    // Clears the local SDK session without leaving the page, so the header shows Login.
    setSessionExpiredHandler(() => logout({ openUrl: false }));
  }, [isLoading, isAuthenticated, getAccessTokenSilently, logout]);

  useEffect(() => {
    const { next, syncProfile, clearUserData } = authTransition(state.current, {
      isLoading,
      isAuthenticated,
      sub: user?.sub,
    });
    state.current = next;

    if (clearUserData) {
      queryClient.removeQueries(USER_QUERY_PREFIX);
    }
    if (!syncProfile) return;

    registerUser({
      name: user.name?.slice(0, 100),
      // The API only accepts https images.
      image: user.picture?.startsWith("https://") ? user.picture : undefined,
    }).catch(() => {
      // Errors are shown by the api.js interceptor; allow a retry on the next change.
      if (state.current.syncedSub === user.sub) {
        state.current = { ...state.current, syncedSub: null };
      }
    });
  }, [isLoading, isAuthenticated, user, queryClient]);

  return null;
};

export default AuthSync;

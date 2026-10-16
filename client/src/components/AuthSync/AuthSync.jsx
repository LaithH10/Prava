import { useEffect, useRef } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { registerUser } from "../../utils/api";
import { setSessionExpiredHandler, setTokenGetter } from "../../utils/auth";

// Connects Auth0 to the API layer. Renders nothing.
// Nothing happens until the SDK has finished initialising (isLoading false).
const AuthSync = () => {
  const { isLoading, isAuthenticated, user, getAccessTokenSilently, logout } =
    useAuth0();
  const syncedSub = useRef(null);

  useEffect(() => {
    setTokenGetter(
      !isLoading && isAuthenticated ? () => getAccessTokenSilently() : null
    );
    // Clears the local SDK session without leaving the page, so the header shows Login.
    setSessionExpiredHandler(() => logout({ openUrl: false }));
  }, [isLoading, isAuthenticated, getAccessTokenSilently, logout]);

  useEffect(() => {
    if (isLoading || !isAuthenticated || !user || syncedSub.current === user.sub) {
      return;
    }
    syncedSub.current = user.sub;
    registerUser({
      name: user.name?.slice(0, 100),
      // The API only accepts https images.
      image: user.picture?.startsWith("https://") ? user.picture : undefined,
    }).catch(() => {
      // Errors are shown by the api.js interceptor; allow a retry on the next login.
      syncedSub.current = null;
    });
  }, [isLoading, isAuthenticated, user]);

  return null;
};

export default AuthSync;

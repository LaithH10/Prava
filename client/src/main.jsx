import React from "react";
import ReactDOM from "react-dom/client";
import { Auth0Provider } from "@auth0/auth0-react";
import "./index.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Auth0Provider
      domain={import.meta.env.VITE_AUTH0_DOMAIN}
      clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: import.meta.env.VITE_AUTH0_AUDIENCE,
      }}
      // Tokens stay in memory only; refresh tokens renew them, with the SDK's
      // silent-login fallback when no refresh token is available (e.g. after reload).
      cacheLocation="memory"
      useRefreshTokens
      useRefreshTokensFallback
    >
      <App />
    </Auth0Provider>
  </React.StrictMode>
);

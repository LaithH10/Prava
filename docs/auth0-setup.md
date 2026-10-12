# Milestone 2: Auth0 setup guide and frontend plan

Status: **for review**. Laith does the Auth0 dashboard steps (sections 1–6); Claude guides.
Claude starts `feat/auth0-web` only after Laith confirms the setup.
No app database changes, no merge and no deploy without Laith's approval.

Values used throughout. Change them consistently if needed:

| Name | Value |
|---|---|
| Tenant region | **EU** |
| Tenant domain | `<tenant>.eu.auth0.com`, shown in the dashboard after creation |
| API identifier (audience) | `https://api.prava` |
| Email claim namespace | `https://prava/` |
| Local frontend | `http://localhost:5173` (Vite default) |
| Local API | `http://localhost:8000/api` |

---

## 1. Tenant (free plan)
1. Sign up or log in at auth0.com. When asked to create a tenant:
   - **Region: Europe (EU)**
   - **Environment tag: Development**
   - Tenant name: e.g. `prava-dev`. It becomes `prava-dev.eu.auth0.com` and can't be renamed later.
2. Stay on the Free plan. **No credit card or upgrade is needed** for anything in this guide.

## 2. API, "Prava API"
Applications → APIs → **Create API**
- Name: `Prava API`
- Identifier: `https://api.prava`. It's a label, not a real URL, and **can't be changed** later.
- JWT profile: Auth0
- Signing algorithm: **RS256**

Then open the API's **Settings** tab:
- **Allow Offline Access: ON** (needed for refresh tokens)
- Maximum access token lifetime: leave the default for now. The SPA renews tokens itself.

## 3. Application, "Prava Web"
Applications → Applications → **Create Application** → **Single Page Web Applications** → name `Prava Web`.

**Settings tab:**
| Field | Value |
|---|---|
| Allowed Callback URLs | `http://localhost:5173` |
| Allowed Logout URLs | `http://localhost:5173` |
| Allowed Web Origins | `http://localhost:5173` |
| Allowed Origins (CORS) | `http://localhost:5173` |

Further down the same page:
- **Refresh Token Rotation:** turn on *Allow Refresh Token Rotation*. Keep the default reuse interval.
- **Refresh Token Expiration:** turn on *Set Idle Refresh Token Lifetime*. The defaults are fine.

Click **Save**.

The Domain and Client ID at the top of this page go into the env files (section 7). There is **no client secret** in a SPA; never copy one into the frontend.

Staging and production URLs are added to the same four fields later, when we deploy.

## 4. Email/password login
Authentication → Database → **Username-Password-Authentication**
- **Applications** tab: enable it for **Prava Web**.
- Leave **Disable Sign Ups** off, so users can register.
- Keep the default password policy, or raise it to *Good*.

Verification emails are sent automatically on sign-up through Auth0's built-in email provider, which is fine for testing. Its sending limits are low; a real email provider is a launch task.

## 5. Google login
Authentication → Social → **Create Connection** → **Google / Gmail** → Continue
- **Leave Client ID and Client Secret empty for now.** Auth0 then uses its shared *development keys*.
  - These work for local testing, but they show Auth0 branding and aren't allowed in production.
  - Before launch: create a free Google OAuth client in Google Cloud Console, enter its keys here, and add `https://<tenant>.eu.auth0.com/login/callback` as its redirect URI. Separate step, later.
- Attributes: Basic Profile and Extended Profile (email) are on by default; keep them.
- **Applications** tab: enable it for **Prava Web**.

## 6. Post-login Action (email claims)
1. Actions → Library → **Create Action** → **Build from scratch**
   - Name: `Add Prava email claims`
   - Trigger: **Login / Post Login**
   - Runtime: the default (latest Node)
2. Replace the editor contents with [`auth0-post-login-action.js`](./auth0-post-login-action.js), then click **Deploy**.
3. Actions → Triggers → **post-login**: drag `Add Prava email claims` between *Start* and *Complete*, then click **Apply**.

The Action adds `https://prava/email` and `https://prava/email_verified` to access tokens for `https://api.prava`. The API uses `email_verified` to allow creating properties and booking visits (403 otherwise). Identity is always the token's `sub`.

## 7. Environment variables (Laith fills these in locally; none of them are secrets)
`server/.env` (add):
```
AUTH0_DOMAIN=<tenant>.eu.auth0.com
AUTH0_AUDIENCE=https://api.prava
CORS_ORIGIN=http://localhost:5173
```

`client/.env.local` (new file, gitignored):
```
VITE_API_URL=http://localhost:8000/api
VITE_AUTH0_DOMAIN=<tenant>.eu.auth0.com
VITE_AUTH0_CLIENT_ID=<Client ID of Prava Web>
VITE_AUTH0_AUDIENCE=https://api.prava
```

Domain, client ID and audience are visible to every visitor of a SPA by design. Still, the files stay local, and the committed `.env.example` files hold placeholders only.

**Setup confirmation:** when sections 1–7 are done, tell Claude "Auth0 setup done". Claude then checks, without any secrets, that `https://<tenant>.eu.auth0.com/.well-known/openid-configuration` and `/.well-known/jwks.json` respond, and that the server starts with the new env.

---

## 8. How the React app connects to the protected API (`feat/auth0-web`)
No visual redesign. New UI elements reuse the existing `.button` styles and header layout.

1. **Provider.** Add `@auth0/auth0-react`. `main.jsx` wraps `<App />` in:
   ```jsx
   <Auth0Provider
     domain={import.meta.env.VITE_AUTH0_DOMAIN}
     clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
     authorizationParams={{
       redirect_uri: window.location.origin,
       audience: import.meta.env.VITE_AUTH0_AUDIENCE,
     }}
     useRefreshTokens
     useRefreshTokensFallback
     cacheLocation="memory"
   >
   ```
2. **Header.**
   - Logged out: the existing **Login** button calls `loginWithRedirect()`. Auth0's Universal Login page offers both email/password and "Continue with Google".
   - Logged in: show the user's avatar or initial (from the ID token's `picture`/`name`) and a **Logout** button with the same `.button` class, calling `logout({ logoutParams: { returnTo: window.location.origin } })`.
   - The same applies to the mobile menu.
3. **Tokens for API calls.**
   - A small `AuthTokenBridge` component inside the provider registers `getAccessTokenSilently` with `utils/api.js`.
   - An axios request interceptor adds `Authorization: Bearer <token>` to `/user/*` and `POST /residency/create` calls only. Public listing calls stay token-free.
   - On a 401 from the API, the client prompts a fresh login. On a 403 ("verify your email"), it shows a toast.
4. **Profile sync.** When `isAuthenticated` first becomes true, call `POST /api/user/register` once with `{ name, image }` from the ID token. The server ignores anything else and only accepts an `https` image.
5. **Session restore.**
   - Tokens are kept **in memory only**, so nothing sits in localStorage where injected scripts could read it.
   - On a page reload the SDK tries a silent login through Auth0's session (`useRefreshTokensFallback`). This works in browsers that allow Auth0's cookie in an iframe, Chrome by default.
   - In Safari and Firefox, which block third-party cookies, a reload shows the user as logged out. Clicking **Login** then signs them straight back in without a password, because the Auth0 session still exists.
   - The full fix is an Auth0 custom domain (e.g. `login.<domain>`), a later launch task. **Decision for Laith:** accept this for now (recommended), or use `cacheLocation="localstorage"` for seamless reloads, at the cost of tokens readable by injected scripts.
6. **Protected pages.** A `RequireAuth` wrapper (`withAuthenticationRequired`) is ready for the milestone 3 pages: add property, my bookings, favourites. No new pages in milestone 2.

## 9. Acceptance tests for milestone 2
Automated: `yarn test` in server stays 23/23 (35/35 with `RUN_DB_TESTS=1`), and the client production build passes. Manual tests run in the browser pane against local servers, with screenshots or notes in the PR:

| # | Test | Expected |
|---|---|---|
| A1 | Click **Login** → sign up with a new email/password | Redirected back to Prava; header shows the user and **Logout** |
| A2 | The same user, before verifying the email: try a write (via a temporary dev check or API call) | API returns 403 "verify your email"; the client shows a toast, not a crash |
| A3 | Verify the email, log out and in again | `email_verified` claim is true; the write is allowed (200) |
| A4 | **Continue with Google** | Logged in; a **separate** user (different `sub`) from the email/password account, as accepted for MVP |
| A5 | After login, check the API | `POST /user/register` returned the user's own profile; `GET /user/bookings` returns 200 with a Bearer token |
| A6 | Call `GET /user/bookings` without login | 401 |
| A7 | Two users (email + Google) | Each sees only their own (empty) bookings and favourites |
| A8 | **Logout** | Header shows **Login**; protected calls are no longer sent with a token; Auth0 session ended (Login asks for credentials again) |
| A9 | Reload the page while logged in, in Chrome | Still logged in (silent restore) |
| A10 | Reload while logged in, in a browser blocking third-party cookies | Shows logged out; one click on **Login** returns without a password (documented limitation) |
| A11 | Leave the tab open past access-token expiry, then make a call | A new token is fetched with the refresh token; the call succeeds |
| A12 | Tokens in browser storage | Nothing Auth0-related in localStorage or sessionStorage (memory cache) |
| A13 | Public pages (home, properties, property detail) logged out | Unchanged; no token sent; no visual changes |
| A14 | Mobile width (375px) | Login/Logout reachable in the existing mobile menu; layout unchanged |
| A15 | App database | Untouched. Login testing writes only users, and **needs approval first** (see below) |

**Database during milestone 2:**
- Real logins create `User` documents. Pointing the local server at `LystedRealEtstate` would write to the app database, and its schema indexes haven't been applied yet.
- **Proposal: during milestone 2, run the local server against a separate `prava_dev` database** with its own `prava-dev` user, readWrite on `prava_dev` only.
- Applying the schema to `LystedRealEtstate` stays a separate approval before deployment.

## 10. Delivery
- Branch `feat/auth0-web`, from `feat/auth0-api`. One draft PR into `feat/auth0-api`.
- Planned commits:
  1. provider and env templates
  2. header login and logout (desktop and mobile)
  3. token bridge and axios interceptor
  4. profile sync and error toasts
  5. docs and test notes
- No merge or deploy without approval.

## Decisions needed from Laith
1. Session restore: memory cache with the noted reload limitation (recommended), or localStorage.
2. A `prava_dev` database and user for local login testing (recommended), instead of using `LystedRealEtstate`.

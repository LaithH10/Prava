# Milestone 2: Auth0 setup guide and frontend plan

Status: **plan approved** (2026-10-13), revision 2. Laith does the Auth0 and Atlas setup (sections 1–7); Claude guides.
Claude starts `feat/auth0-web` only after Laith confirms the setup.

Decisions:
- Tokens are kept in memory only, with refresh token rotation and the SDK's fallback.
- Development logins use a separate `prava_dev` database, never `LystedRealEtstate`.
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

## 7. Development database `prava_dev` (MongoDB Atlas)
Real logins create `User` documents, so local development must never point at the app database.

1. Atlas → Database & Network Access → **+ Add New Database User**
   - Username `prava-dev`, **Autogenerate** password, then **Copy**
   - **Built-in Role:** none (0 selected)
   - **Specific Privileges:** exactly one row, `readWrite` @ `prava_dev`
   - **Add User**. Afterwards the Roles column must show only `readWrite@prava_dev`.
2. Keep the current `prava-app` connection string somewhere safe outside the repo (e.g. your password manager). It's only needed when we deploy.
3. In `server/.env`, set `DATABASE_URL` to the `prava-dev` user and the `prava_dev` database:
   ```
   DATABASE_URL="mongodb+srv://prava-dev:<password>@prava.ilbm7.mongodb.net/prava_dev?retryWrites=true&w=majority&appName=Prava"
   ```
4. Claude verifies the live roles read-only, then applies the schema to `prava_dev` **only**, with the same guarded approach as `prava_test`.

**Guard in code (part of `feat/auth0-web`):** the server refuses to start when `DATABASE_URL` points at `LystedRealEtstate`, unless `ALLOW_APP_DATABASE=1` is set. That flag is used only for the approved production deployment.

## 8. Environment variables (Laith fills these in locally; none of them are secrets)
`server/.env` (add, next to the `prava_dev` `DATABASE_URL` above):
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

**Setup confirmation:** when sections 1–8 are done, tell Claude "Auth0 setup done". Claude then checks, without printing any secrets:
- that `https://<tenant>.eu.auth0.com/.well-known/openid-configuration` and `/.well-known/jwks.json` respond
- that `prava-dev` has only `readWrite@prava_dev`
- that the server starts against `prava_dev`

---

## 9. How the React app connects to the protected API (`feat/auth0-web`)
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
   - While the SDK initialises (`isLoading`), the app **never assumes a login state**. The header keeps the Login button's space but disables it, and no protected call is made until initialisation has finished.
   - Logged out: the existing **Login** button calls `loginWithRedirect()`. Auth0's Universal Login page offers both email/password and "Continue with Google".
   - Logged in: show the user's avatar or initial (from the ID token's `picture`/`name`) and a **Logout** button with the same `.button` class, calling `logout({ logoutParams: { returnTo: window.location.origin } })`.
   - The same applies to the mobile menu.
3. **Tokens for API calls.**
   - A small `AuthTokenBridge` component inside the provider registers `getAccessTokenSilently` with `utils/api.js`.
   - An axios request interceptor adds `Authorization: Bearer <token>` to `/user/*` and `POST /residency/create` calls only. Public listing calls stay token-free.
   - On a 401 from the API, the client prompts a fresh login. On a 403 ("verify your email"), it shows a toast.
   - **Failed token renewal:** if `getAccessTokenSilently` throws (`login_required`, `missing_refresh_token`, `invalid_grant`, or a network error), the request isn't sent. The user sees a "session expired, please log in again" toast and the Login button, never a broken page or a request without a token.
4. **Profile sync.** After initialisation, when `isAuthenticated` first becomes true, call `POST /api/user/register` once with `{ name, image }` from the ID token. The server ignores anything else and only accepts an `https` image.
5. **Session restore (decided: memory only).**
   - Tokens, including refresh tokens, are kept **in memory only**. Nothing is written to localStorage or sessionStorage, so a reload clears them.
   - On a reload the SDK tries a silent restore through the Auth0 session (`useRefreshTokensFallback`). Whether that works depends on each browser's cookie rules and settings, so **we don't promise any particular result**. Tests B1–B3 record what actually happens in Chrome, Firefox and Safari (or WebKit), and the PR documents it.
   - Whatever the result, the app must handle both outcomes cleanly: either logged in, or logged out with a working Login button.
   - If the results are poor, an Auth0 custom domain is the known remedy. That's a later launch decision, not part of this milestone.
6. **Protected pages.** A `RequireAuth` wrapper (`withAuthenticationRequired`) is ready for the milestone 3 pages: add property, my bookings, favourites. No new pages in milestone 2.

## 10. Acceptance tests for milestone 2
**Automated:**
- `yarn test` in server stays green: 23/23, or 35/35 with `RUN_DB_TESTS=1`.
- New server test: startup is refused when `DATABASE_URL` points at `LystedRealEtstate`.
- The client production build passes.

**Manual tests** run in the browser pane against local servers and `prava_dev`. Results go into the PR with notes or screenshots. "Record" means the outcome is documented as observed, not assumed.

**Login, logout, identity**
| # | Test | Expected |
|---|---|---|
| A1 | Load the app; watch the header during SDK initialisation | No login state is shown and no protected call is made until initialisation finishes |
| A2 | **Login** → sign up with a new email/password (desktop) | Back on Prava; header shows the user and **Logout**; `POST /user/register` returns this user's own profile |
| A3 | **Login** → **Continue with Google** (desktop) | Logged in as a **separate** user (different `sub`), as accepted for the MVP |
| A4 | Login and logout at mobile width (375px) | Both work from the existing mobile menu; layout unchanged |
| A5 | **Logout**, app session | Header shows **Login**; protected requests stop carrying a token; protected data disappears from the UI |
| A6 | **Logout**, Auth0 session | Clicking **Login** again asks for credentials, so the Auth0 session really ended (not just the app's) |

**Authenticated API requests**
| # | Test | Expected |
|---|---|---|
| B4 | Logged in: `GET /user/bookings`, `GET /user/favourites` | 200 with a Bearer token (checked in the network panel) |
| B5 | Logged out: the same calls | 401; the UI handles it without crashing |
| B6 | Public pages logged out (home, properties, property detail) | Unchanged; no Authorization header sent; no visual changes |
| B7 | Two users (email and Google) | Each sees only their own (empty) bookings and favourites |

**Email verification**
| # | Test | Expected |
|---|---|---|
| C1 | Unverified email/password user tries a write (create property or book visit, via the API) | 403 "verify your email"; the client shows a toast |
| C2 | Verify the email via Auth0's email, then log out and in | `email_verified` is true in the token and the write is allowed. Also **record** whether a token refresh alone (without re-login) picks up the change |
| C3 | Google user | `email_verified` is true without extra steps |

**Session restore and token renewal (record results, no promises)**
| # | Test | Expected |
|---|---|---|
| B1 | Reload while logged in, **Chrome** (browser pane) | **Record** whether the session restores silently or shows logged out; either way the app is consistent and Login works |
| B2 | Reload while logged in, **Firefox** | **Record** the result, as for B1 |
| B3 | Reload while logged in, **Safari/WebKit** (if available; otherwise noted as untested) | **Record** the result, as for B1 |
| B8 | Wait past access-token expiry (or use a short test lifetime on the API), then make a protected call | **Record:** a new token is fetched with the refresh token and the call succeeds |
| B9 | **Failed renewal:** revoke the session in the Auth0 dashboard (Users → user → *Sessions* / revoke refresh tokens), then make a protected call | Renewal fails; no request is sent without a token; "session expired" toast; Login button shown; no broken page |
| B10 | Browser storage after login | Nothing Auth0-related in localStorage or sessionStorage |

**Databases**
| # | Test | Expected |
|---|---|---|
| D1 | `LystedRealEtstate` after all tests | Unchanged: still no collections (read-only check) |
| D2 | `prava_dev` | Contains only the users created by these manual tests |

## 11. Delivery
- Branch `feat/auth0-web`, from `feat/auth0-api`. One draft PR into `feat/auth0-api`.
- Planned commits:
  1. app-database startup guard and env templates
  2. provider with the loading state
  3. header login and logout (desktop and mobile)
  4. token bridge, axios interceptor and failed-renewal handling
  5. profile sync and error toasts
  6. docs with the recorded test results
- Review material: the implementation diff and the results table above.
- No merge, no deploy, no changes to `LystedRealEtstate`.

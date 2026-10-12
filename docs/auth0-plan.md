# Auth0 implementation plan (for review, not yet approved)

Status: **proposal**. No code is written until Laith approves this plan.
Base: `chore/launch-readiness` (`574e91b`).

## Goal
Users can log in. The API knows who is calling from a verified token, never from the request body.
Protected routes reject anonymous calls, and users can only act on their own data.

## What Laith sets up in Auth0 (free plan; Claude guides, Laith clicks)
1. Create an Auth0 tenant (EU region).
2. Create an **Application**, type *Single Page Application*, named "Prava Web".
   - Allowed Callback URLs, Logout URLs and Web Origins: `http://localhost:5173` (staging URL added later).
3. Create an **API** named "Prava API" with identifier `https://api.prava` (the audience) and signing algorithm RS256.
4. Add a **post-login Action** that puts the user's email and `email_verified` into the access token as namespaced claims (`https://prava/email`, `https://prava/email_verified`). By default, Auth0 access tokens don't contain the email.
5. Enable an email/password database connection, and optionally Google login.

None of these values are secrets. Domain, client ID and audience are public by design in a SPA.
No client secret is needed.

## Configuration
| Where | Variable | Example |
|---|---|---|
| server/.env | `AUTH0_ISSUER_BASE_URL` | `https://<tenant>.eu.auth0.com/` |
| server/.env | `AUTH0_AUDIENCE` | `https://api.prava` |
| client/.env.local | `VITE_AUTH0_DOMAIN` | `<tenant>.eu.auth0.com` |
| client/.env.local | `VITE_AUTH0_CLIENT_ID` | from the Auth0 application |
| client/.env.local | `VITE_AUTH0_AUDIENCE` | `https://api.prava` |

The `.env.example` files are updated with placeholders.

## Backend
- New `server/middleware/auth.js`:
  - `requireAuth` uses `express-oauth2-jwt-bearer` (already a dependency) to check signature, issuer, audience and expiry. Failures return 401.
  - `requireVerifiedEmail` reads the email claims, returns 403 if the email isn't verified, and sets `req.userEmail`.
- Routes:

  | Route | Today | After |
  |---|---|---|
  | `GET /residency/allresd`, `GET /residency/:id` | public | public (unchanged) |
  | `POST /residency/create` | trusts `userEmail` in body | protected; owner = token email; `userEmail` in body ignored |
  | `POST /user/register` | trusts body | protected; creates/returns the caller's own user from the token |
  | `POST /user/bookVisit/:id`, `POST /user/removeBooking/:id`, `POST /user/toFav/:rid` | trust `email` in body | protected; act on the token's user only |
  | `POST /user/allBookings`, `POST /user/allFav` | trust `email` in body | protected; change to `GET` (no body needed; no client uses them yet) |
- Controllers read `req.userEmail` instead of `req.body.email`. A caller can no longer act for someone else.
- Bookings and favourites check that the residency exists (404), so ids that don't exist can't be stored.
- **Identity key decision:** keep email as the user key for v1. That's the smallest change, and it's safe because only verified emails are accepted.
  - Alternative: key users on Auth0's `sub`. That's more robust if users change email, and costs a schema change.
  - The database is empty, so either is cheap now. **Recommendation: email for v1**, revisit before public launch.

## Frontend
- Add `@auth0/auth0-react`. Wrap the app in `Auth0Provider` in `main.jsx` with audience and `useRefreshTokens` + `cacheLocation: "memory"`. Memory storage means no tokens in localStorage, and refresh tokens avoid third-party-cookie problems.
- Header: the existing **Login** button triggers `loginWithRedirect`. When logged in it shows the user's avatar or name and **Logout**.
- `utils/api.js`: an axios interceptor adds `Authorization: Bearer <token>` from `getAccessTokenSilently()` to protected calls.
- After login, call `POST /user/register` once to sync the profile.
- A small `RequireAuth` wrapper for future protected pages (add property, my bookings, favourites).
- No visual redesign. The existing header styles are reused.

## Tests
- **Server (automated, `yarn test`):** tests sign their own tokens with a test-only key, so they never need Auth0 or the internet. The middleware takes the issuer, audience and key from env, and tests use a local secret.
  - Missing token → 401. Bad signature, expired or wrong audience → 401.
  - Valid token with an unverified email → 403.
  - Valid token → protected routes work (with `RUN_DB_TESTS=1` against `prava_test`).
  - An `email`/`userEmail` in the body is ignored: user A can't book or favourite as user B.
  - Public routes still work without a token.
- **Client:** production build passes. A manual checklist covers login, logout, page refresh while logged in, a protected call with and without login, and token expiry. Playwright end-to-end tests come in the testing phase.

## Delivery
- Branch `feat/auth0` from `chore/launch-readiness`, with a draft PR. Planned commits:
  1. server middleware and tests
  2. route/controller changes
  3. client provider and login button
  4. API token interceptor
  5. env templates and docs
- Laith reviews the PR (and ChatGPT independently). Nothing is merged or deployed without approval.

## Out of scope for this milestone
- Add-property form, favourites/bookings UI (next milestone, built on this)
- Roles/admin, edit/delete property with owner checks (needed once those routes exist)
- Deployment, Atlas network restrictions, CI

## Decisions needed from Laith
1. Approve the plan overall.
2. Email (recommended) or Auth0 `sub` as the user key for v1.
3. Email/password only, or also Google login.

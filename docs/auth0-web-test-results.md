# Milestone 2: frontend Auth0 test results

Date: 2026-10-16. Branch `feat/auth0-web`. Local run: client `http://localhost:5173`, API `http://localhost:8787` (Windows reserves port 8000 on the test PC), database `prava_dev` (user `prava-dev`, readWrite on `prava_dev` only).
Auth0: development tenant `dev-to1sqsexaq6usgw5.eu.auth0.com`, SPA "Prava real estate", API `https://api.prava`.
Browser: the Claude desktop browser pane (Chromium-based, blocks third-party cookies).

## Automated
| Check | Result |
|---|---|
| `yarn test` (server, no database) | 27/27 pass (4 new: app-database startup guard) |
| `RUN_DB_TESTS=1 yarn test` | 39/39 pass |
| Server startup against `LystedRealEtstate` | Refused with exit code 1 (unless `ALLOW_APP_DATABASE=1`) |
| Client production build | Passes |

## Manual (browser)
| # | Test | Result |
|---|---|---|
| A1 | No login state before SDK init | ✅ Login disabled while loading; no protected call before init |
| A2 | Email/password sign-up and login (desktop) | ✅ Header shows avatar and Logout; `POST /user/register` 200; user stored by `sub` (`auth0\|…`) |
| A3 | Continue with Google | ✅ Separate user (`google-oauth2\|…`), as designed for the MVP |
| A4 | Login and logout in the mobile menu (375px) | ✅ Existing menu and styles; avatar and Logout shown |
| A5 | Logout, app session | ✅ Header shows Login; a protected call is blocked before sending (`NotLoggedInError`, "Please log in first") |
| A6 | Logout, Auth0 session | ✅ The next Login asks for the password again |
| B1 | Reload while logged in (browser pane, Chromium) | 📝 Silent restore attempted (`/authorize` iframe) and failed; the app shows a consistent logged-out state. Login then returns without a password while the Auth0 session is active (a consent screen appears on localhost only). Known limitation of memory-only storage |
| B2 | Reload in Firefox | ⏸ Not tested (not available from the test environment) |
| B3 | Reload in Safari/WebKit | ⏸ Not tested (not available from the test environment) |
| B4 | Authenticated API requests | ✅ `GET /user/bookings` and `/user/favourites` return 200; Bearer header present |
| B5 | Protected calls when logged out | ✅ Never sent |
| B6 | Public listing and detail | ✅ 200, no Authorization header |
| B7 | Isolation, Google vs email user | ✅ The Google user booked and favourited a TEST property. The email user sees neither, and cancelling it with the Google user's `email`/`authId` in the body returns 404. The Google user's data is unchanged |
| B8 | Access-token expiry and successful renewal | ✅ With the API token lifetime temporarily at 60s, a call 70s after login returned 200 (the API rejects tokens older than 60s plus 5s tolerance), so the token was renewed with the refresh token |
| B9 | Failed renewal | ✅ After revoking the test user's grant in Auth0, renewal failed with `consent_required` (refresh-token failure, not an API 401). 0 requests reached the API; "session expired" toast; header switched to Login |
| B10 | Browser storage | ✅ No Auth0 data in localStorage or sessionStorage at any point |
| C1 | Unverified email tries a write | ✅ 403 "Please verify your email address first", shown as a toast |
| C2 | Verify email, log out and in, then write | ✅ Allowed (reached the 404 for a non-existent property); `emailVerified: true` stored. Not separately tested: whether a token refresh alone picks up verification |
| C3 | Google user email verified | ✅ `emailVerified: true` without extra steps |
| D1 | `LystedRealEtstate` | ✅ Untouched: not listed in Atlas Data Explorer (no data) |
| D2 | `prava_dev` | ✅ Contains only test data: 2 users, 1 property titled "TEST — isolation check (milestone 2)" with one booking and one favourite |

## Temporary Auth0 changes (restored)
- The Prava API's Maximum Access Token Lifetime was set from 86400 to 60, and the Implicit/Hybrid lifetime from 7200 to 60, for B8/B9. **Restored to 86400 / 7200 and verified** after a reload.
- B9 revoked the email test user's grant for Prava real estate. The next login asks for consent again.

## Known issues and notes
- Memory-only tokens: whether a session survives a reload depends on the browser (B1). Firefox and Safari are untested. An Auth0 custom domain is the known remedy (launch decision).
- On localhost, Auth0 always shows a consent screen on login. It won't appear on a real domain ("Allow Skipping User Consent" is on).
- Verification emails from Auth0's built-in provider landed in spam. A real email provider is a launch task.
- Auth0's shared Google development keys are in use. Own Google OAuth keys are needed before launch.
- Existing, unrelated to this milestone: React warnings from `react-accessible-accordion` and `GetStarted`; the Contact link points to a third-party email address (`zainkeepscode@gmail.com`); slight horizontal overflow at 375px.

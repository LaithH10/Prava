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
- Existing, unrelated to this milestone: React warnings from `react-accessible-accordion` and `GetStarted`; the Contact link points to a third-party email address (now fixed: replaced by a /contact page); slight horizontal overflow at 375px.

## Review fixes (ChatGPT review of 708fb41)
| Finding | Fix |
|---|---|
| 1. Profile sync skipped after logout and login with the same account | Sync decisions moved into the pure `utils/authTransition.js`: the synced user is forgotten on logout, so the next login syncs again. Regression unit tests in `authTransition.test.js` |
| 2. `QueryClient` recreated on render; user data could survive a user switch | `QueryClient` is a module-level singleton in `App.jsx`. On logout or a user switch, `AuthSync` removes React Query data under the `"user"` key prefix (convention for user-specific queries; public queries are kept) |
| 3. Any 401 treated as an expired session; network errors could log users out | `classifyApiError` treats a 401/403 as auth failures only for protected requests. `classifyRenewalError` separates permanent renewal errors (`login_required`, `consent_required`, `invalid_grant`, `missing_refresh_token`, ...) from temporary ones (network, timeout). Temporary errors show a warning and keep the session |

**Automated (after fixes):** server 27/27, server with test database 39/39, client unit tests 12/12 (new), client build passes.

**Browser (after fixes; run against the app's own module instances):**
| Test | Result |
|---|---|
| 401 from a public endpoint (simulated response) | ✅ Still logged in; no toast |
| Temporary renewal failure (`TypeError: Failed to fetch`) | ✅ Still logged in; request not sent; "Couldn't reach the login service" warning |
| Permanent renewal failure (`invalid_grant`) | ✅ Request not sent; "session expired" toast; header shows Login |
| Same-user re-login | ✅ Exactly one `POST /user/register` (200) for the new login. A redirect login reloads the page, which also resets in-memory state, so the original bug is covered by the unit test (logout/login without reload) |
| Full logout | ✅ The next Login asks for the password |
| Browser storage | ✅ No Auth0 data |
| `LystedRealEtstate` | ✅ Still not listed in Atlas Data Explorer (no data) |

The real (non-simulated) failed renewal was tested before the fixes (B9: `consent_required`). It is classified as permanent by the same code path.

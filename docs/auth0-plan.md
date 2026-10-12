# Auth0 implementation plan, revision 2 (for review, not yet approved)

Status: **proposal**. No Auth0 code is written until Laith approves this revision.
Base: `chore/launch-readiness`.

## Decisions already made (Laith, 2026-10-12)
| Topic | Decision |
|---|---|
| Provider | Auth0 |
| User identity | Auth0 `sub` is the permanent user key. Email is profile data only |
| Login methods | Email/password and Google |
| Token storage | In memory (no localStorage), with refresh tokens |
| Token checks | RS256 signature via JWKS, issuer, audience, expiry. No shared secrets |
| Design | Existing Prava design kept. No redesign |
| Workflow | Feature branches and draft PRs. No merge or deploy without Laith's approval |

## Goal
Users log in with email/password or Google. The API identifies the caller only from a verified access token (`sub`), never from the request body. Protected routes reject anonymous calls, and users can act only on their own data.

## 1. Auth0 setup (Laith clicks, Claude guides; free plan)
1. Create a tenant in the EU region.
2. **Application** "Prava Web", type *Single Page Application*.
   - Callback, Logout and Web Origin URLs: `http://localhost:5173` (staging URL added later).
   - Enable *Refresh Token Rotation*.
3. **API** "Prava API", identifier (audience) `https://api.prava`, signing algorithm **RS256**.
4. **Connections:**
   - *Username-Password-Authentication* (email/password).
   - *google-oauth2*. Auth0's shared Google dev keys work for local testing. Before public launch, Laith creates his own free Google OAuth client and enters it in Auth0.
5. **Post-login Action:** adds `https://prava/email` and `https://prava/email_verified` to the access token, used for profile and contact only.

Domain, client ID and audience are public by design in a SPA. No client secret is used anywhere.

## 2. Data model change (Prisma)
The database is empty, so no data migration is needed.

```prisma
model User {
  id               String      @id @default(auto()) @map("_id") @db.ObjectId
  authId           String      @unique          // Auth0 `sub`, e.g. "auth0|abc" or "google-oauth2|123"
  email            String?                       // profile only, not unique: one person may log in two ways
  emailVerified    Boolean     @default(false)
  name             String?
  image            String?
  bookedVisits     Json[]
  favResidenciesID String[]    @db.ObjectId
  ownedResidencies Residency[] @relation("Owner")
}

model Residency {
  // ...fields unchanged...
  ownerId   String   @db.ObjectId
  owner     User     @relation("Owner", fields: [ownerId], references: [id])
  @@unique(fields: [address, ownerId])
}
```

- `userEmail` on Residency is replaced by `ownerId`, a reference to `User.id`.
- Email/password and Google logins for the same person are two separate users. Account linking is out of scope.
- Indexes are applied with `prisma db push`. This runs on `prava_test` freely, and on the app database **only with Laith's approval**.

## 3. Backend
**New file `server/middleware/auth.js`:**
- `requireAuth` uses `express-oauth2-jwt-bearer` (already a dependency).
  - Settings: `issuer`, `audience`, `jwksUri` and `tokenSigningAlg: "RS256"`.
  - In production these come from `AUTH0_DOMAIN` and `AUTH0_AUDIENCE`. The issuer is `https://<domain>/` and the JWKS address is `https://<domain>/.well-known/jwks.json`.
  - Missing, expired or invalid token, or wrong issuer or audience → **401**.
- `loadUser` finds or creates the `User` by `authId = sub` and refreshes the email claims. It sets `req.user`.
- `requireVerifiedEmail` returns **403** for writes that need a verified email (create property, book visit). Google accounts are always verified, and email/password users verify through Auth0's email.

**Routes:**
| Route | After |
|---|---|
| `GET /api/residency/allresd`, `GET /api/residency/:id` | public (unchanged) |
| `POST /api/residency/create` | auth + verified email; owner = `req.user` (body owner fields ignored) |
| `POST /api/user/register` | auth; returns the caller's own profile (created by `loadUser`) |
| `POST /api/user/bookVisit/:id` | auth + verified email; residency must exist (404) |
| `POST /api/user/removeBooking/:id`, `POST /api/user/toFav/:rid` | auth; caller's own data only; residency must exist for `toFav` |
| `GET /api/user/bookings`, `GET /api/user/favourites` | auth; replace `POST allBookings` and `POST allFav` (no client uses those yet) |

`email` and `userEmail` in request bodies are no longer read anywhere.

**Config:** `server/.env.example` gains `AUTH0_DOMAIN` and `AUTH0_AUDIENCE`.

## 4. Frontend (milestone 2)
- `@auth0/auth0-react`. `Auth0Provider` in `main.jsx` with `authorizationParams.audience`, `useRefreshTokens: true` and `cacheLocation: "memory"`.
- Header: the existing **Login** button calls `loginWithRedirect`, which shows both email/password and Google on Auth0's login page. When logged in, the header shows the name or avatar and **Logout**, styled like the current buttons.
- `utils/api.js`: an axios interceptor adds `Authorization: Bearer <token>` from `getAccessTokenSilently()` to protected calls.
- After login, call `POST /api/user/register` once.
- `RequireAuth` wrapper for future protected pages.
- `client/.env.example` gains `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID` and `VITE_AUTH0_AUDIENCE`.

## 5. Tests: real RS256 tokens, no calls to Auth0
- In the test process, `jose` (already installed with `express-oauth2-jwt-bearer`) creates an RSA key pair.
- A local HTTP server on `127.0.0.1` serves the public key as a JWKS. The tests point the issuer and JWKS address at it, so the production verification code runs unchanged, only with different config.
- The same key signs test tokens with different `sub` and email claims.

| Case | Expected |
|---|---|
| no token / malformed token | 401 |
| token signed by a different key | 401 |
| expired token, wrong issuer, wrong audience | 401 |
| HS256 token (algorithm confusion) | 401 |
| valid token, unverified email, create property / book visit | 403 |
| valid token → register, create property, book, favourite | 200 (DB tests) |
| user A's token tries to cancel or book as user B (body fields) | ignored; acts only on A |
| user A cannot see user B's bookings/favourites | yes |
| public routes without token | 200 |
| duplicate property per owner | 409 (unchanged) |

- The database tests use the dedicated `prava-test` user and the `prava_test` database. The guards from `77c2e76` refuse any other database or the app user.
- The client gets a production build check plus a manual checklist: login and logout with both methods, page refresh while logged in, protected call when logged out, token expiry. Playwright comes in the testing phase.

## 6. Milestones
**Milestone 1, backend auth:** branch `feat/auth0-api` from `chore/launch-readiness`, draft PR.
1. Prisma schema switch to `authId`/`ownerId`, with controllers updated.
2. `auth.js` middleware with RS256/JWKS config from env.
3. Routes protected, body identity removed, `GET` bookings and favourites.
4. Test JWKS harness and the auth tests above. DB tests run against `prava_test`.
5. `.env.example` updates and a short README section.

Done when all tests pass locally (with and without the database), the PR is reviewed, and no Auth0 tenant is needed yet.

**Milestone 2, frontend login:** branch `feat/auth0-web`. Needs the Auth0 tenant from section 1. Provider, login and logout, token interceptor, profile sync, manual checklist.

**Milestone 3, then:** add-property form, my bookings, favourites UI.

## Out of scope
- Account linking (email/password + Google for the same person)
- Roles/admin, edit or delete property with owner checks (added when those routes exist)
- Deployment, Atlas network restrictions, CI

## Needs Laith's approval
1. This revision as a whole.
2. Starting milestone 1. It needs no Auth0 account yet.

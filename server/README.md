# Prava API

Express + Prisma (MongoDB). Run from this folder.

## Setup
1. `yarn install`. On Node newer than 24, add `--ignore-engines`: `express-oauth2-jwt-bearer` doesn't list newer Node versions yet. Deploy on Node 22 or 24 LTS.
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL` (development: `prava_dev`), `AUTH0_DOMAIN` and `AUTH0_AUDIENCE`.
3. `yarn db:setup:dev` once, then `yarn seed:dev` for fictional sample listings.
4. `yarn start` (port 8000 by default; set `PORT` if it's reserved on your machine).

The server refuses to start without the Auth0 settings, and against the app database `LystedRealEtstate` unless `ALLOW_APP_DATABASE=1` (approved deployment only).

## Database scripts (development and test databases only)
| Script | What it does |
|---|---|
| `yarn db:setup:dev` / `yarn db:setup:test` | Checks the live connection (`prava_dev` / `prava_test`, read/readWrite roles on it only), then runs `prisma db push`, backfills `Residency.status`, and creates and verifies the partial unique index `visit_request_one_pending` |
| `yarn seed:dev` | Loads the fictional listings from `data/Residency.json` into `prava_dev` under a demo owner without personal data; idempotent |

Never run `prisma db push` against the app database without approval.

## Authentication
- Protected routes need an Auth0 access token: `Authorization: Bearer <token>`.
- Tokens are verified with RS256 against the tenant's JWKS (signature, issuer, audience, expiry).
- Users are identified by the token's `sub` (`User.authId`). Identity, owner and status fields in request bodies are ignored.
- Optional-auth routes (listing detail) accept requests without a token. If a token is sent, it must be valid (401 otherwise).
- Creating a listing and sending a visit request need a verified email (claims from the Auth0 post-login Action).

## Routes
| Route | Access |
|---|---|
| `GET /api/residency/allresd?q=&city=&country=&minPrice=&maxPrice=&cursor=&limit=` | public; ACTIVE listings; returns `{ items, nextCursor }` |
| `GET /api/residency/:id` | public; archived listings only for their owner |
| `POST /api/residency/create` | login + verified email; 201 |
| `PATCH /api/residency/:id`, `POST /api/residency/:id/archive`, `POST /api/residency/:id/restore` | owner (others get 404) |
| `POST /api/user/register` | login (sets `name`/`image` only) |
| `GET /api/user/listings?status=` | login; own listings with pending visit-request counts |
| `GET /api/user/listings/:id/visit-requests` | owner; requester name and date only |
| `GET /api/user/favourites`, `PUT`/`DELETE /api/user/favourites/:residencyId` | login; idempotent |
| `GET /api/user/visit-requests?status=` | login; own requests |
| `POST /api/user/visit-requests` | login + verified email; 201 |
| `POST /api/user/visit-requests/:id/cancel` | login; own pending requests; idempotent |

**Visit requests** are requests, not confirmed appointments. Statuses: `PENDING`, `CANCELLED`, `EXPIRED` (date passed) and `CLOSED` (listing archived). At most one PENDING request per requester and listing is enforced by the partial unique index. Archiving closes pending requests, and a request created while the listing is being archived is closed too (`409 LISTING_UNAVAILABLE`). Details: `docs/milestone-3-plan.md` on the plan branch.

**Errors** always look like `{ "message", "code", "fields"? }`. Codes: `VALIDATION_ERROR`, `UNAUTHENTICATED`, `EMAIL_NOT_VERIFIED`, `OWN_LISTING`, `NOT_FOUND`, `DUPLICATE_ADDRESS`, `DUPLICATE_REQUEST` (with `existingRequestId`), `LISTING_UNAVAILABLE`, `REQUEST_NOT_PENDING`, `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`, `INTERNAL`.

**Protection:**
- `helmet` headers
- JSON bodies up to 20kb
- rate limits per IP: 30 writes and 300 reads per minute
- validation with zod
- all user input escaped before any regex: Prisma passes `contains`/`startsWith` to MongoDB `$regex` unescaped

## Tests
- `yarn test` runs the API, auth and unit tests. They need no database and no Auth0: tokens are signed with a local key and served from a local JWKS.
- Database tests are opt-in:
  1. You need a database user with readWrite on `prava_test` only, in `.env.test` (see `.env.test.example`).
  2. Run `yarn db:setup:test` once.
  3. Run `RUN_DB_TESTS=1 yarn test`.

  Before writing anything, the tests check the live database, the user's roles and the partial index. Cleanup removes only the current run's data.
- `test/concurrency.test.js` covers parallel duplicate requests, double cancels, cancel versus re-request, archive versus new requests, favourites, duplicate listings and owner versus non-owner edits.

## Known pre-production risks
- Rate limits are per IP and in memory. Behind a proxy, set Express `trust proxy`, and use a shared store if more than one instance runs.
- The app database has no schema or indexes for milestone 3 yet; applying them needs explicit approval before deployment.
- `express-oauth2-jwt-bearer` 1.6.0 should be upgraded and checked in the security audit.

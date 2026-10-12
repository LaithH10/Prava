# Prava API

Express + Prisma (MongoDB). Run from this folder.

## Setup
1. `yarn install`
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL`, `AUTH0_DOMAIN` and `AUTH0_AUDIENCE`.
3. `yarn start` (port 8000 by default)

The server refuses to start without the Auth0 settings.

## Authentication
- Protected routes need an Auth0 access token: `Authorization: Bearer <token>`.
- Tokens are verified with RS256 against the tenant's JWKS (signature, issuer, audience, expiry).
- Users are identified by the token's `sub`, stored as `User.authId`. Identity fields in request bodies are ignored.
- Creating a property and booking a visit also need a verified email. The Auth0 post-login Action provides the `https://prava/email` and `https://prava/email_verified` claims.

| Route | Access |
|---|---|
| `GET /api/residency/allresd`, `GET /api/residency/:id` | public |
| `POST /api/residency/create` | login + verified email |
| `POST /api/user/register` | login (sets `name`/`image` only) |
| `POST /api/user/bookVisit/:id` | login + verified email |
| `POST /api/user/removeBooking/:id`, `POST /api/user/toFav/:rid` | login |
| `GET /api/user/bookings`, `GET /api/user/favourites` | login |

## Tests
- `yarn test` runs the API and auth tests. They need no database and no Auth0: tokens are signed with a local key and served from a local JWKS.
- Database tests are opt-in:
  1. Create a database user that has readWrite on `prava_test` only.
  2. Copy `.env.test.example` to `.env.test` and fill in its connection string.
  3. Run `yarn db:push:test` once. It applies the schema indexes to the test database only.
  4. Run `RUN_DB_TESTS=1 yarn test`.

  Before writing anything, the tests check the live connection. They refuse unless it's the `*_test` database and the user holds only read/readWrite roles on it.

Never run `prisma db push` against the app database without approval.

## Known pre-production risks
- **Concurrent updates to bookings and favourites.** `bookVisit`, `removeBooking` and `toFav` read the user's `bookedVisits` / `favResidenciesID`, change the array in memory and write it back. Two requests from the same user at the same moment can overwrite each other: a booking or favourite may be lost or duplicated. Fix before production with atomic updates, either conditional `$push`/`$pull` via `prisma.$runCommandRaw` or separate `Booking`/`Favourite` collections with unique indexes.
- **No rate limiting** on the API.
- **The app database has no unique indexes for the new schema yet.** `prisma db push` against the app database needs explicit approval before deployment.

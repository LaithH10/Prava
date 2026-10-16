# Milestone 3: real estate features, PRD and technical plan

Status: **proposal for review**. No implementation until Laith (and ChatGPT) approve scope and plan.
Base: `feat/auth0-web` (`192bb7a`, milestone 2 approved). Development database `prava_dev`; integration tests on `prava_test`. No merge, deploy or production-database change without explicit approval.

## 1. Goal
Turn Prava from a homepage with login into a usable listing platform. A logged-in user can:
1. **list a property**
2. **manage** their own listings
3. **save favourites**
4. **book a visit**

Visitors can still browse and search without logging in.

## 2. Users and stories
| As a… | I want to… | So that… |
|---|---|---|
| Visitor (logged out) | browse and search properties, open details | I can explore without an account |
| Visitor | be asked to log in when I try to favourite or book | I understand why it's needed |
| Logged-in user | add a property with photo URL, price, location and facilities | others can find it |
| Owner | edit or archive my own listings, and see my archived ones | I keep my listings current without losing data |
| Owner | see visit requests for my listings | I can prepare for visits |
| Logged-in user | favourite and unfavourite properties, and see my favourites | I can come back to them |
| Logged-in user | book a visit on a date, see my bookings, cancel one | I can plan visits |

**Not in milestone 3:** image upload, messaging, payments, admin role, multi-language, notifications by email, map geocoding changes.

## 3. Screens
All screens reuse the current visual identity: existing colours, `.button`, `primaryText` / `secondaryText` / `orangeText`, `flexCenter` layouts, PropertyCard and Property detail. No redesign. Every screen has loading, empty and error states and works at 375px.

| # | Screen | Route | Access | Notes |
|---|---|---|---|---|
| S1 | Properties (exists) | `/properties` | public | The search bar starts working (title, city, country). The heart on each card toggles a favourite; logged out, it asks to log in |
| S2 | Property detail (exists) | `/properties/:id` | public | The heart works. **Book your visit** opens a small dialog with a native date input. The owner sees **Edit / Archive** and the visit list instead of Book |
| S3 | Add property (new) | `/properties/new` | login + verified email | One form: basics (title, description, price), location (address, city, country, with the existing Map preview), facilities (bedrooms, bathrooms, parking), image URL with live preview. Inline validation messages |
| S4 | Edit property (new) | `/properties/:id/edit` | owner only | Same form, prefilled. Non-owners get 404 (no hint that it exists) |
| S5 | My listings (new) | `/account/listings` | login | The user's listings with Active/Archived tabs, Edit, Archive/Restore, visit count |
| S6 | My bookings (new) | `/account/bookings` | login | Upcoming and past visits with property summary; Cancel for upcoming ones |
| S7 | Favourites (new) | `/account/favourites` | login | Grid of PropertyCards; empty state links to `/properties` |

Navigation:
- Logged in, the existing header menu gains **Add property** and an **Account** entry linking to S5–S7. The mobile menu gets the same entries.
- Protected routes use the `RequireAuth` wrapper (`withAuthenticationRequired`).

## 4. Data model changes (Prisma, MongoDB)
Bookings and favourites move out of arrays on `User` into their own collections, with unique indexes. This **removes the concurrency risk** documented in milestone 1, because every write becomes a single atomic insert, update or delete.

```prisma
model Residency {
  // existing fields unchanged …
  status     ResidencyStatus @default(ACTIVE)   // ACTIVE | ARCHIVED (archive instead of delete)
  bookings   Booking[]
  favourites Favourite[]
  @@index([status, createdAt])
}

enum ResidencyStatus { ACTIVE ARCHIVED }

model Booking {
  id          String        @id @default(auto()) @map("_id") @db.ObjectId
  userId      String        @db.ObjectId
  residencyId String        @db.ObjectId
  date        DateTime                       // the visit day (stored as UTC midnight)
  status      BookingStatus @default(ACTIVE)  // ACTIVE | CANCELLED (cancel instead of delete)
  createdAt   DateTime      @default(now())
  user        User          @relation(fields: [userId], references: [id])
  residency   Residency     @relation(fields: [residencyId], references: [id])
  @@index([userId, status])
  @@index([residencyId, status])
}

enum BookingStatus { ACTIVE CANCELLED }

model Favourite {
  id          String    @id @default(auto()) @map("_id") @db.ObjectId
  userId      String    @db.ObjectId
  residencyId String    @db.ObjectId
  createdAt   DateTime  @default(now())
  user        User      @relation(fields: [userId], references: [id])
  residency   Residency @relation(fields: [residencyId], references: [id])
  @@unique([userId, residencyId])            // can't favourite twice, even concurrently
}
```

- `User.bookedVisits` and `User.favResidenciesID` are **removed**. Only `prava_dev` and `prava_test` hold data (test data only); `LystedRealEtstate` is empty, so nothing needs migrating.
- "One active booking per user per property" can't be a plain unique index, because cancelled bookings must stay. Proposal: a MongoDB **partial unique index** on `{ userId, residencyId }` with `partialFilterExpression: { status: "ACTIVE" }`.
  - Prisma can't declare partial indexes, so the guarded schema script creates it with a raw `createIndexes` command after `prisma db push`, on `prava_dev`/`prava_test` only.
  - A duplicate insert then fails atomically, and the API maps that to 409.
  - Verified by a concurrency test.
- `facilities` stays JSON but is validated to `{ bedrooms, bathrooms, parkings }` as integers 0–50. The old sample data used `parking`, which is normalised.
- Schema changes are applied with the guarded scripts to `prava_dev` and `prava_test` only.

## 5. API changes
Identity always comes from the token. Every user-specific route is scoped to `req.user`. Input is validated with **zod** schemas (proposed new server dependency) before reaching Prisma. Errors keep the existing JSON shape.

**Residencies**
| Method and path | Access | Behaviour |
|---|---|---|
| `GET /api/residency/allresd?q=&city=&country=&minPrice=&maxPrice=&cursor=&limit=` | public | ACTIVE only, newest first, `limit` ≤ 50, cursor pagination; `q` matches title/city/country (case-insensitive, escaped) |
| `GET /api/residency/:id` | public | ACTIVE only (ARCHIVED → 404, except for the owner) |
| `POST /api/residency/create` | login + verified | validated body; owner = caller; 409 duplicate address per owner |
| `PATCH /api/residency/:id` | owner | partial update of allowed fields only; non-owner → 404 |
| `POST /api/residency/:id/archive`, `POST /api/residency/:id/restore` | owner | sets status; ARCHIVED listings drop out of public lists |
| `GET /api/user/listings?status=` | login | the caller's listings, with active booking counts |
| `GET /api/user/listings/:id/bookings` | owner | visit list for one listing (see decision D3 for which visitor details are shown) |

**Favourites** (replaces the non-idempotent toggle)
| Method and path | Behaviour |
|---|---|
| `GET /api/user/favourites` | caller's favourites with residency summaries (ACTIVE only) |
| `PUT /api/user/favourites/:residencyId` | add; idempotent (200 if already there); 404 if the residency doesn't exist or is archived |
| `DELETE /api/user/favourites/:residencyId` | remove; idempotent |

**Bookings** (replace `bookVisit` / `removeBooking`)
| Method and path | Behaviour |
|---|---|
| `GET /api/user/bookings?scope=upcoming\|past` | caller's bookings with residency summaries |
| `POST /api/user/bookings` `{ residencyId, date }` | verified email; date is a valid day, from tomorrow up to 90 days ahead; residency ACTIVE; **not your own listing** (403); one active booking per user per property (409) |
| `POST /api/user/bookings/:id/cancel` | own booking only (others → 404); upcoming only; sets CANCELLED |

The old routes (`/user/bookVisit`, `/user/removeBooking`, `/user/toFav`) are removed; no client uses them.

**Cross-cutting (security tracker items handled in milestone 3)**
- Rate limiting with `express-rate-limit` on all write routes (e.g. 30 writes/min per user/IP) and a looser limit on public reads → 429 with a JSON message.
- `helmet` for standard security headers.
- Request body size limit (`express.json({ limit: "20kb" })`).
- Image URL rules: `https` only, max 500 characters, rendered with `referrerPolicy="no-referrer"`. No uploads.

## 6. Frontend data rules
- **React Query keys:** public data uses `["residencies", filters]` and `["residency", id]`. **All user-specific data uses `["user", …]`**: `["user","favourites"]`, `["user","bookings", scope]`, `["user","listings", status]`, `["user","listing-bookings", id]`. A unit test scans `src/` and fails if a `useQuery` key containing user data doesn't start with `"user"`. That way the logout/user-switch cache clearing always covers them.
- Mutations invalidate the matching keys. The favourite heart updates optimistically and rolls back on error.
- Forms validate on the client too (same rules as the server), but the server is the authority.
- Money: displayed with `Intl.NumberFormat` (see decision D1).

## 7. Implementation phases
Each phase gets its own branch from the previous one and a draft PR. Each needs review before the next starts.

| Phase | Branch | Content |
|---|---|---|
| **3A Backend foundations** | `feat/m3-api` | schema (Booking, Favourite, status, partial unique index for active bookings), zod validation, all endpoints above, rate limiting, helmet, body limit, removal of the old routes; schema applied to `prava_dev`/`prava_test` only |
| **3B Listings UI** | `feat/m3-listings` | S3 Add, S4 Edit, S5 My listings, archive/restore, header links, owner view on S2 |
| **3C Favourites UI** | `feat/m3-favourites` | hearts on S1/S2, S7 page, optimistic updates |
| **3D Bookings UI** | `feat/m3-bookings` | booking dialog on S2, S6 My bookings, cancel, owner's visit list |
| **3E Search and seed data** | `feat/m3-search` | working search and filters on S1; a `prava_dev` seed script with fictional sample listings (no real people's data) |

## 8. Tests
**Server** (node:test; integration tests on `prava_test` only, with the existing guards). For every endpoint:
- happy path
- 400 validation
- 401 no token
- 403 rules (unverified, own listing)
- 404 non-owner and non-existent
- 409 duplicates
- 429 rate limit

Plus **concurrency tests**:
- 10 parallel `PUT` favourites → exactly 1 favourite
- 10 parallel bookings → exactly 1 active booking
- parallel cancel and book

**Client:**
- unit tests for the form validation, price formatting, booking date rules and the query-key convention
- the existing auth tests stay green
- component-level tests for AuthSync and the forms (ChatGPT's recommendation), with React Testing Library + jsdom as dev dependencies, if approved

**Manual** (browser pane, against `prava_dev`), per phase, with two users (email and Google):
- the full flows of each screen
- the mobile width check
- the ownership checks
- recorded in `docs/m3-test-results.md`

## 9. Acceptance criteria
| Area | Criteria |
|---|---|
| Add property | A verified user can create a listing that appears on S1 and S2. Invalid input shows field messages and is rejected with 400 by the API. An unverified user sees the "verify your email" message |
| Manage | Only the owner can edit, archive or restore (others get 404). An archived listing disappears from public lists and details but stays in S5 "Archived". Nothing is permanently deleted |
| Favourites | The heart reflects state on S1, S2 and S7. Toggling is idempotent and concurrency-safe. Logged out, it asks to log in. Another user never sees my favourites |
| Bookings | Book a valid date: it shows in S6, and the owner sees it. No booking on your own listing, past dates, dates over 90 days ahead, or archived listings. One active booking per property. Cancel works only for my own upcoming booking |
| Search | Text and filters narrow S1. Logged-out search works. Pagination doesn't duplicate or skip |
| Cache | Every user-specific key starts with `"user"` (tested). Logout or a user switch clears them |
| Security | All writes are rate-limited; helmet is on; the body limit is on. No identity from request bodies. All the tests above pass |
| Design | Existing look kept; works at 375px; loading, empty and error states present |
| Data | Only `prava_dev` and `prava_test` touched; `LystedRealEtstate` unchanged (checked) |

## 10. Security tracker (open items, carried until the security audit)
| Item | Status / plan |
|---|---|
| Concurrent updates to bookings and favourites | **Fixed in 3A** by the new collections and unique indexes, with concurrency tests |
| Rate limiting | **3A** (`express-rate-limit`) |
| Input validation | **3A** (zod on every route) |
| Security headers, body size | **3A** (`helmet`, JSON limit) |
| Atlas network access `0.0.0.0/0` | Deployment decision (hosting with fixed egress IPs, or Atlas private endpoints); before launch |
| Old leaked credential in git history | Revoked; history rewrite optional, needs separate approval |
| **Real third-party email in `server/data/Residency.json`** (19 entries, unused by the code) and the Contact link to `zainkeepscode@gmail.com` | **3E** replaces the sample file with fictional data, and the Contact link becomes Laith's choice. Personal data shouldn't stay in a public repo |
| Auth0: shared Google dev keys, test email provider, custom domain for session restore, the auto-created Test Application | Before launch |
| Dependency audit (`yarn audit`), Express and other upgrades | Security audit |
| `app DB` schema indexes | Applied to `LystedRealEtstate` only with explicit approval before deployment |
| Separate **security audit** (milestone S) | Mandatory before any public deployment |

## 11. Decisions needed from Laith
| # | Decision | Recommendation |
|---|---|---|
| D1 | Currency and number format | **EUR, Dutch formatting** (`€ 250.000`), replacing the `$` from the tutorial |
| D2 | Images | **URL only** in milestone 3; uploads (e.g. Cloudinary) later, as they need storage, costs and moderation |
| D3 | What owners see about visitors | **Visitor's name and visit date only**; showing email/phone needs a privacy notice and the visitor's consent (GDPR) |
| D4 | Removing listings and bookings | **Archive/cancel only**, no permanent deletes (matches the project rule) |
| D5 | New dependencies | Server: `zod`, `express-rate-limit`, `helmet`. Client tests: `vitest`, `@testing-library/react`, `jsdom` (dev only). All pinned to versions at least 2 weeks old |
| D6 | Booking rules | From tomorrow up to 90 days ahead; one active booking per user per property; no booking your own listing |
| D7 | Phase order | 3A → 3B → 3C → 3D → 3E as above |

# Milestone 3: real estate features, PRD and technical plan (revision 2)

Status: **revision 2 for review**. Decisions D1–D7 were approved (some with adjustments) on review of `e56a850`. Phase 3A code starts only after this revision is approved.
Base: `feat/auth0-web` (`192bb7a`, milestone 2 approved). Development database `prava_dev`; integration tests on `prava_test`. `main` and `LystedRealEtstate` stay untouched. No merge or deploy without explicit approval.

### Changes since revision 1
1. Bookings renamed throughout to **visit requests**, with a single status model and API (sections 4, 5, 6).
2. A partial unique index for pending requests, with exact cancel, re-request, expiry, archive and concurrency rules (section 4.3).
3. An access matrix for archived listings (section 4.4).
4. The sample-data and Contact-email cleanup moved to the **start of 3A** (section 8, step 3A-0).
5. Data retention and erasure requirements, without building a GDPR system yet (section 9).
6. An extended concurrency and duplicate-submission test list (section 10).

## 1. Goal
Turn Prava from a homepage with login into a usable listing platform. A logged-in user can:
1. **list a property**
2. **manage** their own listings
3. **save favourites**
4. **request a visit**

Visitors can still browse and search without logging in.

**Visit requests are requests, not appointments.** The owner sees the request; confirming, declining and scheduling happen outside Prava in milestone 3. The UI says so wherever a request is made or shown.

## 2. Users and stories
| As a… | I want to… | So that… |
|---|---|---|
| Visitor (logged out) | browse and search properties, open details | I can explore without an account |
| Visitor | be asked to log in when I try to favourite or request a visit | I understand why it's needed |
| Logged-in user | add a property with an https photo URL, price, location and facilities | others can find it |
| Owner | edit, archive and restore my own listings | I keep them current without losing data |
| Owner | see visit requests for my listings (requester's name and requested date) | I can follow up |
| Logged-in user | favourite and unfavourite properties, and see my favourites | I can come back to them |
| Logged-in user | send a visit request for a date, see my requests and their status, cancel a pending one | I can plan visits |

**Not in milestone 3:** image upload, owner confirm/decline of requests, messaging, payments, admin role, multi-language, email notifications, a self-service account deletion UI (see section 9).

## 3. Screens
All screens reuse the current visual identity: existing colours, `.button`, `primaryText` / `secondaryText` / `orangeText`, `flexCenter` layouts, PropertyCard and Property detail. No redesign. Every screen has loading, empty and error states and works at 375px. Prices use EUR with Dutch formatting (`€ 250.000`, D1).

| # | Screen | Route | Access | Notes |
|---|---|---|---|---|
| S1 | Properties (exists) | `/properties` | public | Search works (title, city, country). The heart toggles a favourite; logged out, it asks to log in |
| S2 | Property detail (exists) | `/properties/:id` | public; archived: owner only | The heart works. The button text becomes **Request a visit** and opens a dialog with a native date input and the note: "This sends a visit request to the owner. It is not a confirmed appointment. The owner will see your name and the requested date." The owner sees **Edit / Archive or Restore** and the request list instead. An archived listing shows an "Archived, not visible to others" banner to its owner |
| S3 | Add property (new) | `/properties/new` | login + verified email | One form: basics, location (with the existing Map preview), facilities, https image URL with live preview. Inline validation messages |
| S4 | Edit property (new) | `/properties/:id/edit` | owner only (also when archived) | The same form, prefilled. Non-owners get the standard not-found page |
| S5 | My listings (new) | `/account/listings` | login | Active/Archived tabs, Edit, Archive/Restore, count of pending visit requests |
| S6 | My visit requests (new) | `/account/visit-requests` | login | Grouped as Pending (upcoming), Past, Cancelled and Closed, each with a status label. Cancel is available for pending ones |
| S7 | Favourites (new) | `/account/favourites` | login | Grid of PropertyCards; empty state links to `/properties` |

Navigation:
- Logged in, the header menu gains **Add property** and **Account** (S5–S7). The mobile menu gets the same entries.
- Protected routes use the `RequireAuth` wrapper.
- Submit buttons are disabled while their request is in flight, so double clicks don't send duplicates.

## 4. Data model (Prisma, MongoDB)

### 4.1 Models
```prisma
model Residency {
  // existing fields unchanged …
  status        ResidencyStatus @default(ACTIVE)   // ACTIVE | ARCHIVED
  archivedAt    DateTime?
  visitRequests VisitRequest[]
  favourites    Favourite[]
  @@index([status, createdAt])
  @@index([ownerId, status])
}
enum ResidencyStatus { ACTIVE ARCHIVED }

model VisitRequest {
  id           String             @id @default(auto()) @map("_id") @db.ObjectId
  requesterId  String             @db.ObjectId
  residencyId  String             @db.ObjectId
  requestedDate DateTime                              // the requested day, stored as 00:00 UTC
  status       VisitRequestStatus @default(PENDING)
  createdAt    DateTime           @default(now())
  updatedAt    DateTime           @updatedAt
  closedAt     DateTime?                             // when it left PENDING
  requester    User               @relation(fields: [requesterId], references: [id])
  residency    Residency          @relation(fields: [residencyId], references: [id])
  @@index([requesterId, status])
  @@index([residencyId, status])
}
enum VisitRequestStatus { PENDING CANCELLED EXPIRED CLOSED }

model Favourite {
  id          String    @id @default(auto()) @map("_id") @db.ObjectId
  userId      String    @db.ObjectId
  residencyId String    @db.ObjectId
  createdAt   DateTime  @default(now())
  user        User      @relation(fields: [userId], references: [id])
  residency   Residency @relation(fields: [residencyId], references: [id])
  @@unique([userId, residencyId])
}
```

- `User.bookedVisits` and `User.favResidenciesID` are **removed**. Only `prava_dev` and `prava_test` hold data, and only test data, so nothing needs migrating.
- `facilities` stays JSON, validated to `{ bedrooms, bathrooms, parkings }` as integers 0–50.

### 4.2 Visit-request statuses
| Status | Meaning | Set by | Final? |
|---|---|---|---|
| `PENDING` | Sent and waiting; the requested date is in the future | create | no |
| `CANCELLED` | Withdrawn by the requester | requester (cancel) | yes |
| `EXPIRED` | The requested date has passed while pending | system (lazily, see 4.3) | yes |
| `CLOSED` | The listing was archived while pending | system (archive) | yes |

Final statuses never change again. Restoring a listing **does not** reopen closed requests; the requester can send a new one. Every transition is a **conditional update** (`where: { id, status: "PENDING", … }`), so two concurrent transitions can't both apply.

### 4.3 One pending request per requester and listing: partial unique index
- **Index:** `{ requesterId: 1, residencyId: 1 }`, `unique: true`, `partialFilterExpression: { status: "PENDING" }`, named `visit_request_one_pending`.
  - Prisma can't declare partial indexes, so the guarded schema script creates it with a raw `createIndexes` command after `prisma db push`, on `prava_dev`/`prava_test` only.
  - The script verifies that the index exists with exactly these options. The API test suite also checks it at startup and fails loudly if it's missing.
- **Create** (`POST /visit-requests`):
  1. Validate the body (date from tomorrow up to 90 days ahead, in Europe/Amsterdam calendar days).
  2. Check that the residency exists and is ACTIVE; otherwise 404 for non-owners. The owner gets `403 OWN_LISTING`.
  3. **Expire stale pending requests first:** `updateMany({ requesterId, residencyId, status: "PENDING", requestedDate: { lt: today } } → EXPIRED)`. Then a past-dated pending request never blocks a new one.
  4. Insert with status PENDING. A unique-index violation (MongoDB E11000, surfaced by Prisma as `P2002`) → **409 `DUPLICATE_REQUEST`**, with the existing request's id in the body. This makes double submissions safe: exactly one is stored.
  5. **Archive race guard:** after inserting, re-read the residency status. If it's no longer ACTIVE (archived between steps 2 and 4), conditionally set the new request to CLOSED and return **409 `LISTING_UNAVAILABLE`**. Together with the archive step below, no PENDING request can remain on an archived listing, whichever order the two operations run in.
- **Cancel** (`POST /visit-requests/:id/cancel`): a conditional update `where { id, requesterId: caller, status: "PENDING" }` → CANCELLED, with `closedAt`.
  - Not found or not the caller's → **404**.
  - Already CANCELLED → **200** with the current request (idempotent; a double click is harmless).
  - EXPIRED or CLOSED → **409 `REQUEST_NOT_PENDING`**.
  - Because the update is conditional, two parallel cancels change the request once and both return 200.
- **Re-request after cancel:** allowed straight away, because CANCELLED requests aren't covered by the partial index. A cancel and a create racing each other yield either (a) cancel first, then the create succeeds with 201, or (b) create first, then 409 `DUPLICATE_REQUEST` and the cancel succeeds. Either way, at most one PENDING request exists. The client retries once on that 409 if a cancel was just sent.
- **Expiry on read:** list endpoints apply the same EXPIRED update for the caller's past-dated pending requests before returning, so statuses shown are always current. No background job is needed.

### 4.4 Archived listings: access matrix
| Action on an ARCHIVED listing | Public / non-owner | Owner |
|---|---|---|
| Appears in `GET /residency/allresd` and search | no | no (only in "My listings → Archived") |
| `GET /residency/:id` | **404** (same as non-existent) | 200, with `status: "ARCHIVED"` |
| Edit (`PATCH`) | 404 | allowed |
| Restore | 404 | allowed → ACTIVE (pending requests stay CLOSED) |
| Favourite (`PUT`) | 404 | n/a (you can't favourite your own listing; 403 `OWN_LISTING`) |
| Existing favourites | kept in the database, **hidden** from `GET /user/favourites`; reappear after restore | n/a |
| New visit request | 404 | 403 `OWN_LISTING` |
| Existing pending requests | **closed** on archive (`updateMany` PENDING → CLOSED) | sees them as CLOSED in the request list |
| Requester's view of a closed request | listed in "Closed" with only the title and "listing no longer available"; no link to the detail page | — |

Archive and restore are conditional updates on `status`, so repeating them is harmless (200 either way).

## 5. API
- Identity always comes from the token, and every user-specific route is scoped to `req.user`.
- Input is validated with **zod**.
- Successful creates return **201**; other successes return **200** with the resource.

**Error format**, the same everywhere: `{ "message": "<human-readable>", "code": "<STABLE_CODE>", "fields"?: { "<field>": "<message>" } }`

| Code | HTTP | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | zod failure (with `fields`) or malformed id/JSON |
| `UNAUTHENTICATED` | 401 | missing or invalid token |
| `EMAIL_NOT_VERIFIED` | 403 | write needing a verified email |
| `OWN_LISTING` | 403 | requesting a visit to or favouriting your own listing |
| `NOT_FOUND` | 404 | doesn't exist, isn't yours, or is archived and you're not the owner |
| `DUPLICATE_ADDRESS` | 409 | same address already listed by this owner |
| `DUPLICATE_REQUEST` | 409 | a pending request already exists (body includes its id) |
| `LISTING_UNAVAILABLE` | 409 | listing archived during the request |
| `REQUEST_NOT_PENDING` | 409 | cancelling an expired or closed request |
| `RATE_LIMITED` | 429 | rate limit hit |
| `INTERNAL` | 500 | anything else (no details) |

The existing milestone 1/2 error responses gain the `code` field; their `message` text stays the same.

**Residencies**
| Method and path | Access | Behaviour |
|---|---|---|
| `GET /api/residency/allresd?q=&city=&country=&minPrice=&maxPrice=&cursor=&limit=` | public | ACTIVE only, newest first, `limit` ≤ 50, cursor pagination; `q` is escaped and case-insensitive |
| `GET /api/residency/:id` | public | per the matrix in 4.4 |
| `POST /api/residency/create` | login + verified | owner = caller; 201 |
| `PATCH /api/residency/:id` | owner | allowed fields only |
| `POST /api/residency/:id/archive`, `.../restore` | owner | idempotent; archive also closes pending requests |
| `GET /api/user/listings?status=ACTIVE\|ARCHIVED` | login | the caller's listings with pending-request counts |
| `GET /api/user/listings/:id/visit-requests` | owner | `[{ id, requesterName, requestedDate, status, createdAt }]`. **Only the requester's name and the date** (D3); no email or other details |

**Favourites**
| Method and path | Behaviour |
|---|---|
| `GET /api/user/favourites` | ACTIVE listings only |
| `PUT /api/user/favourites/:residencyId` | idempotent add (201 when created, 200 when it already existed); 404 per the matrix; 403 `OWN_LISTING` |
| `DELETE /api/user/favourites/:residencyId` | idempotent remove (200 either way) |

**Visit requests** (replace `bookVisit`, `removeBooking`, `allBookings`)
| Method and path | Behaviour |
|---|---|
| `GET /api/user/visit-requests?status=` | the caller's requests, statuses current (see 4.3) |
| `POST /api/user/visit-requests` `{ residencyId, requestedDate }` | verified email; rules in 4.3; 201 |
| `POST /api/user/visit-requests/:id/cancel` | rules in 4.3 |

The old routes (`/user/bookVisit`, `/user/removeBooking`, `/user/toFav`, `/user/bookings`) are removed; no client uses them.

**Cross-cutting:**
- `express-rate-limit`: about 30 writes per minute per user (by `sub`) or IP, and a looser limit on public reads.
- `helmet` for security headers.
- `express.json({ limit: "20kb" })`.
- Image URLs: https only, ≤ 500 characters.

## 6. Frontend data rules
- **React Query keys:**
  - Public: `["residencies", filters]` and `["residency", id]`.
  - **User-specific, always `["user", …]`:** `["user","favourites"]`, `["user","visit-requests", status]`, `["user","listings", status]`, `["user","listing-visit-requests", id]`.
  - A unit test scans the source and fails on any user-specific query key that doesn't start with `"user"`.
- Mutations invalidate the matching keys. The favourite heart is optimistic, with rollback.
- The client maps API error codes to messages, for example `DUPLICATE_REQUEST` → "You already have a pending visit request for this property", with a link to S6.
- Copy says "visit request" consistently. Statuses shown are "Pending", "Cancelled", "Expired", and "Closed (listing no longer available)".

## 7. Decisions (approved on review of `e56a850`)
| # | Decision |
|---|---|
| D1 | EUR, Dutch number formatting |
| D2 | https image URLs only; no uploads in milestone 3 |
| D3 | Owners see the requester's name and requested date only; requests are described as requests, not confirmed appointments |
| D4 | Archive listings and cancel requests in normal operation; retention and erasure planned (section 9) |
| D5 | `zod`, `express-rate-limit`, `helmet`; client tests with `vitest`, `@testing-library/react`, `jsdom` (dev only); all pinned to versions at least 2 weeks old |
| D6 | Requests from tomorrow up to 90 days ahead; one pending request per user and listing; none on your own listing |
| D7 | Phases 3A → 3E |

**Open, needed before step 3A-0:**
| # | Decision |
|---|---|
| D8 | What the Contact link should point to: Laith's preferred address, e.g. a Hadid Company or portfolio contact, or a contact page instead of a `mailto:` |

## 8. Implementation phases
Each phase gets its own branch from the previous one and a draft PR, with review before the next phase starts.

| Phase | Branch | Content |
|---|---|---|
| **3A-0 Data hygiene (first commit of 3A)** | `feat/m3-api` | Replace `server/data/Residency.json` with **fictional sample listings** (no real names or emails; owner fields removed). Replace the Contact `mailto:` with the D8 choice. Search the repo for other third-party personal data. Note: the old values stay in git history (rewrite optional, separate approval) |
| **3A Backend** | `feat/m3-api` | models and statuses, guarded schema script incl. the partial index and its verification, zod, error codes, all endpoints above, rate limiting, helmet, body limit, removal of the old routes, `prava_dev` seed script with the fictional data |
| **3B Listings UI** | `feat/m3-listings` | S3, S4, S5, the owner view and archived banner on S2, header links |
| **3C Favourites UI** | `feat/m3-favourites` | hearts on S1/S2, S7 |
| **3D Visit requests UI** | `feat/m3-visit-requests` | the request dialog with notice on S2, S6, the owner's request list |
| **3E Search** | `feat/m3-search` | search, filters and pagination on S1 |

## 9. Data retention and erasure (requirements now, full system later)
Milestone 3 doesn't build a GDPR management system. It makes sure the data **can** be retained, exported and erased correctly later, and writes the rules down.

**Data inventory (Prava database):**
| Collection | Personal data | Linked by |
|---|---|---|
| User | `authId` (Auth0 sub), email, name, image URL | `id` |
| Residency | owner link; free text could contain personal data | `ownerId` |
| VisitRequest | requester link, requested date | `requesterId` |
| Favourite | user link | `userId` |

Outside the database, Auth0 holds the identity (email, password hash or Google link, login history), and server logs may contain IPs.

**Requirements built in milestone 3:**
1. Every personal record is reachable by the user's `id` (indexed), so export and erasure can find everything.
2. Store only what's needed: name, email and image from the token. No phone numbers or addresses of people.
3. Owners see only the requester's name and date (D3).
4. Server logs don't print request bodies or tokens (already true since milestone 1).
5. A written **erasure runbook** in `docs/` describes the future steps:
   - delete the user's favourites and visit requests
   - archive and detach or delete their listings, with the open question of keeping anonymised listing history
   - delete the User document
   - delete the Auth0 user
   - remove the user from backups per the backup retention

   No erasure is executed in milestone 3. Real erasures need Laith's approval, matching the project's no-permanent-deletion rule for routine work.

**Decided later** (before public launch, as part of the security and privacy audit):
- retention periods, e.g. delete CANCELLED/EXPIRED/CLOSED requests after 12 months, and deactivated accounts after 24 months
- a privacy notice and the requester-consent wording
- a self-service "delete my account" flow
- the data export format
- a processing record (Auth0, MongoDB Atlas and hosting as processors, with EU regions)

## 10. Tests
**Server** (node:test; integration tests only on `prava_test`, with the existing guards).

For every endpoint:
- happy path
- 400 `VALIDATION_ERROR` with `fields`
- 401
- 403 (`EMAIL_NOT_VERIFIED`, `OWN_LISTING`)
- 404 for non-owner, non-existent and archived (per the matrix)
- 409 codes
- 429
- the error body shape

Each test uses its own run-scoped users and data and cleans up only those, as now.

**Concurrency and duplicate-submission tests** (run with `Promise.all` against the real `prava_test` indexes):
| # | Scenario | Expected |
|---|---|---|
| T1 | 10 parallel identical visit requests (same user and listing) | exactly 1 × 201 and 9 × 409 `DUPLICATE_REQUEST`; 1 PENDING in the database |
| T2 | 2 parallel cancels of the same request | both 200; one state change; `closedAt` set once |
| T3 | cancel and new request in parallel, repeated 20× | never more than 1 PENDING; every response is 200/201 or 409 `DUPLICATE_REQUEST` |
| T4 | cancel, then re-request | 201; the old one stays CANCELLED |
| T5 | archive in parallel with 10 new requests from different users, repeated 20× | afterwards **0 PENDING** on the archived listing; each request returned 201 (then CLOSED by the archive) or 409 `LISTING_UNAVAILABLE` |
| T6 | archive with pending requests, then restore | requests CLOSED and stay CLOSED after restore; a new request succeeds |
| T7 | a pending request whose date has passed | shown as EXPIRED; a new request for the same listing → 201 |
| T8 | 10 parallel `PUT` favourites, plus parallel `PUT`/`DELETE` mixes | exactly 0 or 1 favourite at the end, never a duplicate; all responses 200/201 |
| T9 | 5 parallel identical property creations | 1 × 201 and 4 × 409 `DUPLICATE_ADDRESS` |
| T10 | parallel archive and restore by the owner | final state is consistent (ACTIVE or ARCHIVED); all responses 200 |
| T11 | the partial index is missing (simulated in a separate test database) | the test suite fails loudly with a clear message |
| T12 | non-owner `PATCH`/archive while the owner edits | non-owner always 404; owner's edit unaffected |

**Client:**
- unit tests for form validation, EUR formatting, date rules, error-code messages and the `["user", …]` key scan
- component tests (`vitest` + Testing Library) for the forms, the request dialog (including the disabled button while submitting) and AuthSync, following the milestone 2 review recommendation

**Manual** (browser pane, `prava_dev`, two users: email and Google), per phase:
- all flows, including double clicks, archive and restore, and an expired request
- the mobile check
- results in `docs/m3-test-results.md`

## 11. Acceptance criteria
| Area | Criteria |
|---|---|
| Data hygiene | No real third-party names or emails remain in the working tree; Contact link per D8 |
| Add property | A verified user can create a listing (201) that appears on S1 and S2. Invalid input shows field messages and the API returns `VALIDATION_ERROR`. An unverified user sees the verify-email message |
| Manage | Only the owner can edit, archive or restore. Archived listings follow the matrix in 4.4 exactly. Nothing is permanently deleted |
| Favourites | Consistent heart state across S1, S2 and S7. Idempotent and concurrency-safe (T8). Archived listings hidden. Never visible to other users |
| Visit requests | Labelled as requests everywhere, with the notice. Date rules, own-listing rule and one-pending rule enforced. Statuses correct (pending, cancelled, expired, closed). Owners see name and date only. T1–T7 pass |
| Search | Text and filters work logged out. Pagination has no duplicates or gaps. Archived listings never appear |
| API consistency | Every error uses the documented shape and codes |
| Cache | Every user-specific key starts with `"user"` (tested); cleared on logout or user switch |
| Security | Writes rate-limited; helmet; body limit; no identity from request bodies; all listed tests pass |
| Privacy | Section 9 items 1–5 done; the erasure runbook written |
| Design | Existing look kept; 375px works; loading, empty and error states |
| Data | Only `prava_dev` and `prava_test` touched; `LystedRealEtstate` unchanged (checked); `main` untouched |

## 12. Security tracker (open until the mandatory security audit, milestone S)
| Item | Status / plan |
|---|---|
| Concurrent updates to bookings and favourites | Fixed in 3A (collections, unique and partial indexes, conditional updates), with T1–T10 |
| Rate limiting, input validation, headers, body size | 3A |
| Third-party personal data in sample data and the Contact link | **3A-0** (first step); history rewrite optional, separate approval |
| Atlas network access `0.0.0.0/0` | Deployment decision; before launch |
| Old leaked credential in git history | Revoked; history rewrite optional, separate approval |
| Auth0: Google dev keys, test email provider, custom domain, unused Test Application | Before launch |
| Retention periods, privacy notice, account deletion, export | Before launch (section 9) |
| Dependency audit and upgrades | Security audit |
| App-database schema and indexes | Applied to `LystedRealEtstate` only with explicit approval before deployment |

# Erasure runbook (draft, milestone 3)

Status: **draft procedure. Not automated and not to be executed** without Laith's explicit approval for the specific request. Retention periods, the privacy notice, self-service account deletion and data export are decided before public launch (see `docs/milestone-3-plan.md`, section 9).

## Where a user's personal data lives
| Store | Data | How to find it |
|---|---|---|
| Prava database, `User` | `authId` (Auth0 sub), email, name, image URL | `authId` |
| `Favourite` | user link | `userId` = User.id |
| `VisitRequest` | requester link, requested date | `requesterId` = User.id |
| `Residency` | owner link; free-text fields may contain personal data | `ownerId` = User.id |
| Auth0 | identity, email, password hash or Google link, login history | Auth0 dashboard → Users |
| Server logs, backups | possibly IP addresses; copies of the above | hosting and Atlas backup retention |

## Steps for an approved erasure request
1. Confirm the request and the person's identity (via the email address in Auth0), and record the request date.
2. Look up `User.id` by `authId`.
3. Delete their `Favourite` and `VisitRequest` records.
4. Their listings:
   - archive them first (this closes pending requests by others)
   - then delete them, or detach and anonymise them if listing history must be kept. **This is an open decision.**
5. Delete the `User` document.
6. Delete the user in Auth0.
7. Note when backups containing the data will expire (Atlas backup retention), and keep a minimal record that the erasure was done: date and request reference, no personal data.
8. Confirm completion to the person within the legal deadline (GDPR: one month).

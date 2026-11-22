# Planned Feature: Optional Google Sign-In

| | |
|---|---|
| **Status** | **Planned — Phase 2. Not implemented.** |
| **Phase 1 impact** | None. Phase 1 has no authentication, no accounts, and no database. This document must not be read as a description of working functionality. |
| **Priority** | P2 — after Knowledge Explorer and Evidence Analyzer. |
| **Owner decisions needed** | Hosting with persistent storage; Google Cloud project setup; final privacy policy text; legal check for minors (see §6). |

---

## 1. Goal

Let a student **optionally** sign in with their Google account so that their learning progress follows them across devices. SCIORA must remain fully usable without signing in.

## 2. Requirements

1. Use **Google Identity Services (GIS)** — the "Sign in with Google" button (One Tap optional).
2. **Verify the Google ID token on the server.** Never trust identity data decoded in the browser.
3. Request only the minimal scopes: **`openid`, `email`, `profile`**.
4. **No Gmail, Google Drive, Calendar, or any other Google API access.** SCIORA uses GIS *authentication* only and never requests OAuth access tokens for Google APIs.
5. **Authentication is optional.** Every learning feature works without an account.
6. **Privacy protections for users under 18** (§6).
7. **Account-based synchronisation of learning progress** (§5).
8. **Secure sessions, logout, and account deletion** (§4).

## 3. Sign-in flow (planned)

```
Browser                                   SCIORA server                         Google
───────                                   ─────────────                         ──────
GET /api/auth/nonce ───────────────────►  create random nonce (single use, 5 min)
◄──────────────────────────────────────── nonce
GIS button (client_id, nonce) ─────────────────────────────────────────────────► user consents
◄────────────────────────────────────────────────────────────────────────────── ID token (JWT)
POST /api/auth/google {credential} ─────► verify ID token:
  (same-origin, CSRF-protected)             • signature against Google public keys
                                            • aud == SCIORA client ID
                                            • iss == accounts.google.com
                                            • exp not passed
                                            • nonce matches and is consumed (single use)
                                            • email_verified == true (if email is used)
                                          find/create user by `sub` (not by email)
                                          create session, set cookie
◄──────────────────────────────────────── 200 {signedIn: true, displayName}
```

Implementation notes for Phase 2:
- Verification uses Google's official library (`google-auth-library`, `OAuth2Client.verifyIdToken` with `audience` set to SCIORA's client ID). Exact API usage will be confirmed against the library documentation at implementation time.
- The Google **client ID** is public configuration (`GOOGLE_CLIENT_ID`). The ID-token flow does not need a client secret; none is stored.
- The user's stable identifier is Google's `sub` claim. Email addresses can change and are not used as the key.
- No Google access token or refresh token is ever requested or stored.

## 4. Sessions, logout, and account deletion

**Sessions**
- After successful verification, the server creates a session with a random 256-bit ID, stored server-side (database). The browser receives only that opaque ID.
- Cookie: `__Host-sciora_session`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`.
- Session ID is regenerated on every sign-in (prevents session fixation).
- Expiry: idle timeout (e.g. 7 days) and absolute timeout (e.g. 30 days) — values to be confirmed.
- State-changing endpoints require a same-origin check (`Origin` header) plus a CSRF token.
- Rate limiting on all `/api/auth/*` endpoints.

**Logout**
- `POST /api/auth/logout`: deletes the server-side session, clears the cookie, and calls `google.accounts.id.disableAutoSelect()` in the browser so One Tap does not silently sign the user back in.
- Local (anonymous) progress on the device is left untouched unless the user also chooses "Clear my data".

**Account deletion**
- `POST /api/account/delete` (requires a confirmed, signed-in session): **immediately and permanently** deletes the user record, all synced progress, and all of the user's sessions.
- Optionally revokes SCIORA's sign-in grant with Google (`google.accounts.id.revoke`).
- Deletion is confirmed to the user. No soft-delete or hidden backup copy of progress is kept.
- A "Download my data" export (JSON) is offered before deletion.

## 5. Progress synchronisation

- **Anonymous users:** unchanged from Phase 1 — progress stays in the browser's `localStorage`.
- **Signed-in users:** graded results are recorded on the server at the moment the server grades them. Because grading already happens on the server, synced progress is harder to tamper with than `localStorage`.
- **First sign-in on a device with existing local progress:** the user is **asked** whether to upload it. Nothing is uploaded without consent.
- **Stored per result (minimum needed):** topic, exercise type, verdict, difficulty, timestamp. The student's written answer text is **not** stored.
- **Merging across devices:** results are stored as individual events with unique IDs, so merging means de-duplicating events. The preliminary level estimate is then recalculated from the merged events.
- The level estimate remains a **preliminary estimate**, not proof of mastery, whether or not the user is signed in.

## 6. Privacy protections for users under 18

SCIORA's target users include middle-school students, so the design assumes **any user may be a minor**.

Planned protections:
- **Accounts are optional and off by default.** Nobody needs an account to learn.
- **Data minimisation:** store only Google `sub`, a display name (first name only, or none), and the learning events listed in §5. No profile photo, no birth date, no location, no answer text. Whether to store the email address at all will be decided at implementation; the default is **not to store it**.
- **No advertising, no third-party analytics or tracking, no data sharing or selling.**
- **Guardian notice** shown before sign-in: "If you are under 18, ask a parent or guardian before signing in." Plain English (SCIORA is English-only).
- **Easy control:** download, logout and delete account are always one click away from Settings.
- **Retention:** accounts inactive for a fixed period (e.g. 12 months) are deleted automatically — period to be confirmed.
- **Privacy policy** written in plain English before sign-in is enabled.

**To verify before launch (not yet checked):**
- Google's minimum account age for Morocco and how supervised (Family Link) accounts behave with third-party sign-in.
- Requirements of Morocco's personal-data law (Law 09-08) and the CNDP for processing minors' data.
- Whether other regimes apply because of where users or the competition are located (for example COPPA in the United States for children under 13).

This section is a design intention, **not legal advice**. Sign-in must not be enabled for real users until these points are checked.

## 7. Dependencies on Phase 2 infrastructure

- **Database:** required for users, sessions and synced progress. Proposed: SQLite on persistent storage. The same database would also make the replay store persistent (removing the Phase 1 restart limitation). **No database is added in Phase 1.**
- **Hosting:** the host must provide persistent disk storage. Many free tiers do not. This is an owner decision.
- **Google Cloud setup (by the project owner):** create a project, configure the OAuth consent screen (basic scopes only), create a Web client ID, and register SCIORA's authorised JavaScript origins.
- **Network:** the deployed server must be able to reach Google's public signing keys for token verification.
- **CSP update:** allow `accounts.google.com` for the GIS script and frame.

## 8. Planned tests (Phase 2 — not written yet)

| Test | Expected result |
|---|---|
| App works with sign-in disabled / not configured | All Phase 1 features function; no sign-in button shown |
| Forged ID token (bad signature) | Rejected (401) |
| ID token with wrong `aud` | Rejected |
| ID token with wrong `iss` | Rejected |
| Expired ID token | Rejected |
| Missing, wrong, or reused nonce | Rejected |
| `email_verified=false` (if email is used) | Rejected |
| Requested scopes | Only `openid email profile`; no other Google scopes anywhere in code or config |
| Session cookie flags | `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefix |
| Session regenerated on sign-in | New session ID after each sign-in |
| Logout | Session deleted server-side; old cookie no longer works |
| Cross-origin POST to auth or account endpoints | Rejected (CSRF protection) |
| Account deletion | User, progress and sessions are gone from the database; old session cookie rejected |
| Local progress upload | Only happens after explicit user consent |
| Answer text | Never written to the database |

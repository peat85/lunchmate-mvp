# LunchMatch

Find colleagues for lunch in a few taps. Built for a company of 50–70 people.

## Core flow

1. **Sign in** with your email and password, or create an account with the same two fields.
2. The board shows **open lunches** for today and tomorrow, sorted by time. You can filter them by food.
3. Either:
   - **Join** a lunch: tap *Join*, add an optional comment, then tap *Confirm*. The organiser gets an email.
   - **Offer a lunch**: tap *Offer a lunch*. The day, the next time slot, "Anything" and "Canteen" are preselected, so you can post immediately or change them with one tap each. You can also add a comment.
4. **Your lunch plans** at the top shows who you are eating with, when and where, plus their email addresses so you can coordinate.

A signed-in user needs 2 taps to join a lunch (Join, then Confirm) or 2 taps to post one (Offer, then Post). Both take well under 30 seconds.

## Scope

| MUST HAVE (built) | LATER | DO NOT BUILD (now) |
|---|---|---|
| Email + password accounts, no duplicate emails | Password reset | 2FA / SSO / roles / admin |
| Offer a lunch: day, time, food, place, comment | Group size limit | Calendar, Slack/Teams integration |
| List of open lunches + food filter | Recurring "I'm usually free at 12:00" | Restaurant recommendations |
| Join with a comment, leave, cancel | Email to joiners when a lunch is cancelled | AI matching |
| Email the organiser on join (SMTP, optional) | History / stats | Profiles, avatars, chat |

**Assumptions**
- "Apply" means joining immediately. There is no approval step, which saves a round-trip. The organiser can still see who joined and can cancel.
- There is no name field. Display names come from the email address (`anna.schmidt@…` becomes "Anna Schmidt").
- Lunches can only be for **today or tomorrow**. "Today" follows `APP_TIMEZONE` (default Europe/Berlin).
- A lunch stays visible until 30 minutes after its start time.
- Email addresses are only shown to people in the same lunch.

## Architecture

- **Frontend:** static HTML, CSS and vanilla JS in `public/`. There is no build step, and it is served by Vercel's CDN.
- **Backend:** TypeScript and Express 5 (`src/app.ts`), running as a single Vercel function (`api/index.ts`) or as a local server (`src/server.ts`).
- **Database:** SQLite via Node 24's built-in `node:sqlite`, so there are no native dependencies. Everything is in `src/db.ts`.
- **Auth:** scrypt password hashes and a stateless HMAC-signed HttpOnly cookie, which works across serverless instances.
- **Email:** nodemailer over SMTP. If `SMTP_HOST` is unset, sending is skipped and a join never fails because of email.

### Database schema

```
users   (id PK, email TEXT UNIQUE NOCASE NOT NULL, password_hash TEXT NOT NULL, created_at)
entries (id PK, user_id FK→users NOT NULL, date 'YYYY-MM-DD' NOT NULL, time 'HH:MM' NOT NULL,
         food TEXT NOT NULL default 'Anything', place TEXT NOT NULL default 'To be decided',
         comment TEXT NULL, created_at)
joins   (id PK, entry_id FK→entries ON DELETE CASCADE, user_id FK→users, comment TEXT NULL,
         created_at, UNIQUE(entry_id, user_id))
```

A lunch group is an entry plus its joins. A separate group table isn't needed.

### Matching logic (`src/matching.ts`)

1. Take every lunch dated today or later, ordered by date, then time, then creation order.
2. Drop lunches that are over: today's lunches whose start time was more than 30 minutes ago.
3. **Your plans** are the lunches you created or joined.
4. **Open lunches** are everyone else's lunches whose food matches your filter. "Anything" matches every food on both sides, and the comparison ignores case.

The logic is deterministic: the same data always gives the same order. When several lunches match, all are shown by time. With no matches you see an empty state with "Show all" and "Offer …" buttons. You can join an existing group at any time (duplicate joins are rejected), leave again, and the organiser can cancel.

## API

| Method | Path | Body |
|---|---|---|
| POST | `/api/register`, `/api/login` | `{email, password}` |
| POST | `/api/logout` | — |
| GET | `/api/me` | → `{user}` or `{user: null}` |
| GET | `/api/board?food=Italian` | → `{today, tomorrow, now, mine[], open[], foods[], totalOpen}` |
| POST | `/api/entries` | `{day: "today"\|"tomorrow", time: "HH:MM", food?, place?, comment?}` |
| DELETE | `/api/entries/:id` | creator only |
| POST / DELETE | `/api/entries/:id/join` | `{comment?}` |

## Run locally

Requires Node 24.

```bash
npm install
npm run dev            # http://localhost:3000, DB in ./data/lunchmatch.db
npm test               # vitest: matching, auth, API incl. end-to-end + no-match
npm run typecheck
```

Configuration lives in `.env.example`. Locally, `SESSION_SECRET` falls back to a random value.

## Deploy to Vercel

```bash
export VERCEL_TOKEN=...          # never commit it
npx vercel link --yes --token "$VERCEL_TOKEN"
npx vercel env add SESSION_SECRET production --token "$VERCEL_TOKEN"   # e.g. `openssl rand -hex 32`
# optional: APP_TIMEZONE, APP_URL, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM
npx vercel deploy --prod --yes --token "$VERCEL_TOKEN"
```

## Known limitations

- **Data on Vercel is not durable.** The SQLite file lives in `/tmp` of the function instance. It is wiped when the instance recycles, and parallel instances don't share data. This is fine for a demo but not for real use. To keep SQLite, move to Turso/libSQL (only `src/db.ts` changes) or to a host with a persistent disk.
- Nobody is emailed when a lunch is cancelled. Joiners see it disappear from the board.
- There is no password reset, no email verification and no login rate limiting.
- The board refreshes every 30 seconds while the tab is visible. There is no real-time push.

## Recommended next experiment

Run it for **two weeks with one team of about 10–15 real people**. Measure how many posted lunches get at least one joiner, and ask participants whether they had lunch with someone they wouldn't otherwise have asked. That tests the key assumption: people will actually post and join lunches through a board, rather than just asking in chat. Make storage durable first.

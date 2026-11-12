# Newsletter — RSS-to-email (free, self-hosted)

Emails new veluthoor.com blog posts to subscribers automatically. The
subscriber list is ours: no MailerLite, no signup limits.

**Architecture**
- **Feed:** `https://veluthoor.com/rss.xml` (full post content via `content:encoded`)
- **List:** Netlify Blobs (free, built into Netlify), one record per subscriber,
  keyed by a hash of their email. Managed by Netlify functions in
  `netlify/functions/`, with shared code in `netlify/lib/newsletter.mjs`:
  - `POST /api/subscribe` — the site's signup form. Saves the person as
    *pending* and emails them a confirmation link (double opt-in). Has a hidden
    bot-trap field and sends at most one confirmation per address per 10 min.
  - `GET /api/confirm` — the confirmation link. Makes them *active*.
  - `/api/unsubscribe` — the link in every newsletter. Opening it shows an
    "Unsubscribe" button (so email security scanners that open links can't
    unsubscribe people by accident); the button, and the one-click unsubscribe
    Gmail/Apple Mail show, unsubscribe immediately.
  - `/api/subscribers` — private, needs `NEWSLETTER_ADMIN_TOKEN`. Lists active
    subscribers (for the send script), exports everything as CSV, and imports.
  - Confirm/unsubscribe links are signed with `NEWSLETTER_SECRET` and contain no
    email address.
- **Send:** Resend API, one personalised email per subscriber, with a
  `List-Unsubscribe` header for one-click unsubscribe.
- **Schedule:** GitHub Actions cron (`.github/workflows/newsletter.yml`), daily.
- **State:** `state.json` tracks which post URLs were already sent; committed back
  to the repo after each run.

## Limits and costs
- **Netlify Blobs / Functions:** free on the Netlify free plan at this scale.
- **Resend free plan:** 3,000 emails/month. Each post costs one email per
  subscriber, and each signup costs one confirmation email. At 250 subscribers
  that's ~12 posts a month; at 1,000 it's ~3.
- **Past that:** Amazon SES is ~$0.10 per 1,000 emails. Only `sendBatch()` in
  `send.mjs` and `sendEmail()` in `netlify/lib/newsletter.mjs` talk to Resend,
  so switching provider is a small change. The list doesn't move.

## Setup

### 1. Generate two random secrets
```bash
openssl rand -hex 32   # → NEWSLETTER_SECRET
openssl rand -hex 32   # → NEWSLETTER_ADMIN_TOKEN
```
Changing `NEWSLETTER_SECRET` later breaks every confirm/unsubscribe link already
sent, so set it once and leave it.

### 2. Netlify environment variables
Netlify → Site configuration → Environment variables:
- `NEWSLETTER_SECRET`
- `NEWSLETTER_ADMIN_TOKEN`
- `RESEND_API_KEY` (same `re_...` key as in GitHub)
- `FROM_EMAIL` (optional, defaults to `Charu <charu@veluthoor.com>`)

### 3. GitHub secret
`veluthoor-site` repo → Settings → Secrets and variables → Actions → Secrets:
- `NEWSLETTER_ADMIN_TOKEN` (same value as on Netlify)
- `RESEND_API_KEY` (already there)

### 4. Resend domain
`veluthoor.com` must be verified in Resend (already done for the sends).

## Moving subscribers in (one-off)
Export active subscribers from MailerLite as CSV, keep it **outside the repo**
(it's personal data and the repo is public; `*.csv` is gitignored anyway), then:

```bash
node newsletter/import.mjs ~/Downloads/subscribers.csv --dry-run
NEWSLETTER_ADMIN_TOKEN=... node newsletter/import.mjs ~/Downloads/subscribers.csv
```

Imported people are marked active straight away (they already confirmed with
MailerLite). Safe to run twice; it never re-adds anyone who unsubscribed.

## Running

```bash
# Local dry run (reads the real list if NEWSLETTER_ADMIN_TOKEN is set, sends nothing):
node newsletter/send.mjs --dry-run

# Send one test email of the newest post to yourself (no list, no state change):
RESEND_API_KEY=re_... node newsletter/send.mjs --test-to=you@example.com

# Real send:
RESEND_API_KEY=re_... NEWSLETTER_ADMIN_TOKEN=... node newsletter/send.mjs

# Only the N newest unsent posts (safety):
node newsletter/send.mjs --limit=1
```

From GitHub: **Actions → Newsletter RSS-to-email → Run workflow** (tick "Dry run"
to check the whole setup, including reading the list, without sending).

If the list comes back empty the send **fails** instead of marking posts as
sent, so a misconfiguration never silently swallows a post.

## Backing up / exporting the list
```bash
curl -H "Authorization: Bearer $NEWSLETTER_ADMIN_TOKEN" \
  "https://veluthoor.com/api/subscribers?format=csv" -o ~/subscribers.csv
```
Every record, any status, with signup/confirm/unsubscribe dates.

## When you publish a new post
Nothing to do — the daily cron picks it up. To send immediately, trigger the
workflow manually from the Actions tab.

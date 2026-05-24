# Newsletter — RSS-to-email (free, self-hosted)

Emails new veluthoor.com blog posts to subscribers automatically. Replaces the
paid MailerLite "RSS campaign" feature.

**Architecture**
- **Feed:** `https://veluthoor.com/rss.xml` (full post content via `content:encoded`)
- **List:** MailerLite owns subscribers + the signup form + unsubscribe handling.
  The script pulls the *current active* list each run, so anyone who unsubscribed
  in MailerLite is automatically excluded.
- **Send:** Resend API (3,000 emails/mo free), one personalized email per subscriber.
- **Schedule:** GitHub Actions cron (`.github/workflows/newsletter.yml`), daily.
- **State:** `state.json` tracks which post URLs were already sent; committed back
  to the repo after each run.

## One-time setup

### 1. Resend
1. Sign up at https://resend.com → **API Keys** → create one (starts `re_`).
2. **Domains → Add domain** → `veluthoor.com`. It shows DNS records (SPF/DKIM).
3. Add those records in **Cloudflare DNS** (DNS only / grey cloud, like the
   MailerLite ones). Resend's SPF include can coexist — merge into the existing
   `v=spf1 ...` line, do **not** add a second SPF record.
4. Wait for Resend to show the domain **Verified**.

### 2. MailerLite API key
- MailerLite → **Integrations → API** (or Account → API) → generate a token.
- This is read-only usage here (listing active subscribers).

### 3. GitHub secrets & variables
In the `veluthoor-site` repo → **Settings → Secrets and variables → Actions**:
- **Secrets:**
  - `RESEND_API_KEY` = your `re_...` key
  - `MAILERLITE_API_KEY` = your MailerLite token
- **Variables (optional):**
  - `FROM_EMAIL` = `Charu <charu@veluthoor.com>` (default if unset)
  - `UNSUBSCRIBE_URL` = your MailerLite hosted unsubscribe/preferences URL
    (see note below)

### 4. Unsubscribe link
The email footer links to `UNSUBSCRIBE_URL`. Point this at MailerLite's hosted
unsubscribe page so unsubscribes land back in the single source of truth.
If unset, it falls back to `https://veluthoor.com/unsubscribe?email=...`
(which you'd need to handle). Set the variable to avoid that.

## Running

```bash
# Local dry run (no keys needed; shows what would send):
node newsletter/send.mjs --dry-run

# Local real send (needs env vars set):
RESEND_API_KEY=re_... MAILERLITE_API_KEY=... node newsletter/send.mjs

# Only the N newest unsent posts (safety):
node newsletter/send.mjs --limit=1
```

From GitHub: **Actions → Newsletter RSS-to-email → Run workflow** (tick "Dry run"
to test without sending).

## First run is safe
`state.json` was seeded with all existing posts at setup, so the tool only emails
posts published *after* setup. It will never blast your back catalogue.

## When you publish a new post
Nothing to do — the daily cron picks it up. To send immediately, trigger the
workflow manually from the Actions tab.

#!/usr/bin/env node
/**
 * RSS-to-email sender for veluthoor.com
 *
 * Flow:
 *   1. Fetch the RSS feed and parse items (title, link, guid, pubDate, content:encoded).
 *   2. Read state.json to find which post links were already sent.
 *   3. Pull the CURRENT active subscriber list from our own list at
 *      /api/subscribers (Netlify function + Netlify Blobs). Anyone who
 *      unsubscribed is excluded, and each subscriber comes with their own
 *      signed unsubscribe link.
 *   4. For each new post, send a full-content email via Resend, one personalized
 *      message per subscriber (own unsubscribe link, no shared To: list).
 *   5. Record sent post links back into state.json.
 *
 * Env vars (required):
 *   RESEND_API_KEY          Resend API key (re_...)
 *   NEWSLETTER_ADMIN_TOKEN  same value as the Netlify env var; lets us read the list
 *   FROM_EMAIL              e.g. "Charu <charu@veluthoor.com>"
 *
 * Optional:
 *   SUBSCRIBERS_URL     defaults to https://veluthoor.com/api/subscribers
 *
 * Flags:
 *   --dry-run   Do everything except actually send; print what would happen.
 *   --limit=N   Only process the N newest unsent posts (safety for first run).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = join(__dirname, 'state.json');

const FEED_URL = 'https://veluthoor.com/rss.xml';
const SITE_URL = 'https://veluthoor.com';
const SUBSCRIBERS_URL = process.env.SUBSCRIBERS_URL || `${SITE_URL}/api/subscribers`;
const RESEND_BATCH_URL = 'https://api.resend.com/emails/batch';
const RESEND_BATCH_SIZE = 100; // Resend: max 100 emails per batch call
const RATE_DELAY_MS = 600;     // pace batch calls (Resend default ~2 req/s)

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitArg = args.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;
// --test-to=addr sends ONE real email (the newest post) to a single address,
// bypassing the subscriber list and without recording state. For verifying the pipeline.
const testArg = args.find(a => a.startsWith('--test-to='));
const TEST_TO = testArg ? testArg.split('=')[1] : null;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function requireEnv(name, { optional = false } = {}) {
  const v = process.env[name];
  if (!v && !DRY_RUN && !optional) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

// In --test-to mode we send to a single address and never read the list,
// so the admin token isn't required.
const RESEND_API_KEY = requireEnv('RESEND_API_KEY');
const NEWSLETTER_ADMIN_TOKEN = requireEnv('NEWSLETTER_ADMIN_TOKEN', { optional: !!TEST_TO });
const FROM_EMAIL = process.env.FROM_EMAIL || 'Charu <charu@veluthoor.com>';

// ---- RSS parsing (no deps; the feed is well-formed RSS 2.0) ----

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function unwrapCdata(s) {
  const m = s.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return m ? m[1] : s;
}

function tag(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
  const m = block.match(re);
  return m ? m[1].trim() : '';
}

function parseFeed(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const link = decodeEntities(unwrapCdata(tag(block, 'link')));
    const guid = decodeEntities(unwrapCdata(tag(block, 'guid'))) || link;
    const title = decodeEntities(unwrapCdata(tag(block, 'title')));
    const pubDate = unwrapCdata(tag(block, 'pubDate'));
    // content:encoded holds the full HTML body (CDATA or entity-escaped)
    let content = tag(block, 'content:encoded');
    content = unwrapCdata(content);
    if (!/[<][a-z]/i.test(content)) content = decodeEntities(content); // escaped HTML
    items.push({ guid, link, title, pubDate, content });
  }
  return items;
}

// ---- Subscriber list: pull current active subscribers ----

async function fetchActiveSubscribers() {
  const res = await fetch(SUBSCRIBERS_URL, {
    headers: { Authorization: `Bearer ${NEWSLETTER_ADMIN_TOKEN}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Subscriber list ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  return (json.subscribers || []).filter(s => s.email && s.unsubscribeUrl);
}

// ---- Email construction ----

function buildHtml(post, subscriber) {
  // Each subscriber's own signed link from the list endpoint. Test sends have
  // none, so they point at the site instead.
  const unsubUrl = subscriber.unsubscribeUrl || SITE_URL;

  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f6f6f6;">
<div style="max-width:640px;margin:0 auto;padding:32px 20px;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
  <h1 style="font-size:22px;line-height:1.3;margin:0 0 4px;">${post.title}</h1>
  <p style="font-size:13px;color:#888;margin:0 0 24px;">${post.pubDate ? new Date(post.pubDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : ''}</p>
  <div style="font-size:16px;line-height:1.7;">
    ${post.content}
  </div>
  <p style="margin:32px 0 0;">
    <a href="${post.link}" style="color:#2563eb;">Read it on veluthoor.com →</a>
  </p>
  <hr style="border:none;border-top:1px solid #eee;margin:32px 0 16px;">
  <p style="font-size:12px;color:#999;line-height:1.6;">
    You're getting this because you subscribed at veluthoor.com.<br>
    <a href="${unsubUrl}" style="color:#999;">Unsubscribe</a>
  </p>
</div>
</body></html>`;
}

function buildText(post) {
  return `${post.title}\n\nRead it on veluthoor.com: ${post.link}\n`;
}

// ---- Resend: batch send ----

async function sendBatch(emails) {
  const res = await fetch(RESEND_BATCH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(emails),
  });
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---- State ----

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_PATH, 'utf8'));
  } catch {
    return { sent: [] };
  }
}

async function saveState(state) {
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

// ---- Main ----

async function main() {
  console.log(`[${new Date().toISOString()}] RSS→email run${DRY_RUN ? ' (DRY RUN)' : ''}`);

  const feedRes = await fetch(FEED_URL);
  if (!feedRes.ok) throw new Error(`Feed ${feedRes.status}`);
  const items = parseFeed(await feedRes.text());
  console.log(`Feed: ${items.length} posts`);

  // --test-to: send the newest post to one address, no list, no state changes.
  if (TEST_TO) {
    const post = items[0]; // feed is newest-first
    console.log(`Test send: "${post.title}" → ${TEST_TO}`);
    const email = {
      from: FROM_EMAIL,
      to: TEST_TO,
      subject: `[TEST] ${post.title}`,
      html: buildHtml(post, { id: 'test', email: TEST_TO }),
      text: buildText(post),
    };
    const result = await sendBatch([email]);
    console.log('Resend response:', JSON.stringify(result));
    console.log('Test send complete. State NOT modified.');
    return;
  }

  const state = await loadState();
  const sentSet = new Set(state.sent);

  // Newest first in the feed; reverse so we email oldest-unsent first.
  let unsent = items.filter(i => !sentSet.has(i.guid)).reverse();
  if (unsent.length > LIMIT) unsent = unsent.slice(-LIMIT);

  if (unsent.length === 0) {
    console.log('No new posts. Nothing to send.');
    return;
  }
  console.log(`New posts to send: ${unsent.length}`);
  unsent.forEach(p => console.log(`  • ${p.title}`));

  // A dry run still reads the real list when the admin token is set (reading
  // is harmless), so a dry run from GitHub Actions checks the whole setup.
  const subscribers = DRY_RUN && !NEWSLETTER_ADMIN_TOKEN
    ? [{ email: 'dry-run@example.com', unsubscribeUrl: `${SITE_URL}/api/unsubscribe?id=dry` }]
    : await fetchActiveSubscribers();
  console.log(`Active subscribers: ${subscribers.length}`);

  if (subscribers.length === 0) {
    // An empty list almost certainly means something is wrong (list not yet
    // imported, endpoint misconfigured). Fail loudly and leave the posts unsent
    // so the next run can deliver them.
    throw new Error('Subscriber list is empty; not sending and not marking posts as sent.');
  }

  for (const post of unsent) {
    const emails = subscribers.map(sub => ({
      from: FROM_EMAIL,
      to: sub.email,
      subject: post.title,
      html: buildHtml(post, sub),
      text: buildText(post),
      // Lets Gmail / Apple Mail show their own one-click "Unsubscribe" button.
      headers: {
        'List-Unsubscribe': `<${sub.unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }));

    if (DRY_RUN) {
      console.log(`\n[DRY] Would send "${post.title}" to ${emails.length} subscriber(s).`);
      console.log(`[DRY] HTML preview (first 300 chars):\n${emails[0].html.slice(0, 300)}…`);
      continue;
    }

    const batches = chunk(emails, RESEND_BATCH_SIZE);
    for (let i = 0; i < batches.length; i++) {
      await sendBatch(batches[i]);
      console.log(`Sent "${post.title}" batch ${i + 1}/${batches.length} (${batches[i].length} emails)`);
      if (i < batches.length - 1) await sleep(RATE_DELAY_MS);
    }
    sentSet.add(post.guid);
    await saveState({ sent: [...sentSet] }); // persist after each post
  }

  if (!DRY_RUN) console.log('Done.');
}

main().catch(err => {
  console.error('FAILED:', err.message);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * One-off: import subscribers from a CSV (e.g. a MailerLite export) into the
 * self-hosted list as already-confirmed subscribers.
 *
 *   NEWSLETTER_ADMIN_TOKEN=... node newsletter/import.mjs ~/Downloads/subscribers.csv
 *   node newsletter/import.mjs ~/Downloads/subscribers.csv --dry-run   (no token needed)
 *
 * It finds the column whose header is "email" (or "Subscriber", "E-mail"), or
 * failing that the first column that contains email addresses. Safe to run
 * twice: existing subscribers are left alone, and anyone who unsubscribed is
 * never re-added.
 *
 * Keep the CSV out of the repo — it's people's personal data and the repo is
 * public. (*.csv is gitignored as a safety net.)
 *
 * Optional: SUBSCRIBERS_URL (defaults to https://veluthoor.com/api/subscribers)
 */

import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const file = args.find(a => !a.startsWith('--'));
const URL_ = process.env.SUBSCRIBERS_URL || 'https://veluthoor.com/api/subscribers';
const TOKEN = process.env.NEWSLETTER_ADMIN_TOKEN;
const BATCH = 100; // the endpoint accepts at most 100 per request

if (!file) {
  console.error('Usage: node newsletter/import.mjs <export.csv> [--dry-run]');
  process.exit(1);
}
if (!DRY_RUN && !TOKEN) {
  console.error('Missing NEWSLETTER_ADMIN_TOKEN');
  process.exit(1);
}

// Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF).
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(f => f.trim()));
}

const looksLikeEmail = s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((s || '').trim());

const rows = parseCsv((await readFile(file, 'utf8')).replace(/^﻿/, ''));
if (rows.length === 0) {
  console.error('CSV is empty');
  process.exit(1);
}

const header = rows[0].map(h => h.trim().toLowerCase());
let col = header.findIndex(h => ['email', 'e-mail', 'email address', 'subscriber'].includes(h));
let dataRows = rows.slice(1);
if (col === -1) {
  // No recognisable header: use the first column holding an email address.
  col = rows[0].findIndex(looksLikeEmail);
  if (col !== -1) dataRows = rows; // first row was data, not a header
  else col = rows[1]?.findIndex(looksLikeEmail) ?? -1;
}
if (col === -1) {
  console.error('Could not find an email column in the CSV');
  process.exit(1);
}

const emails = [...new Set(dataRows.map(r => (r[col] || '').trim().toLowerCase()).filter(looksLikeEmail))];
console.log(`Found ${emails.length} unique email address(es) in column ${col + 1}${header[col] ? ` ("${rows[0][col]}")` : ''}.`);

if (DRY_RUN) {
  console.log('Dry run: nothing imported. First few:', emails.slice(0, 3).map(e => e.replace(/^(.).*(@.*)$/, '$1…$2')).join(', '));
  process.exit(0);
}

const total = { added: 0, activated: 0, alreadyActive: 0, skippedUnsubscribed: 0, invalid: 0 };
for (let i = 0; i < emails.length; i += BATCH) {
  const batch = emails.slice(i, i + BATCH);
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ emails: batch }),
  });
  if (!res.ok) {
    console.error(`Batch ${i / BATCH + 1} failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const r = await res.json();
  for (const k of Object.keys(total)) total[k] += r[k] || 0;
  console.log(`Batch ${i / BATCH + 1}: ${batch.length} sent`);
}
console.log('Done:', JSON.stringify(total));

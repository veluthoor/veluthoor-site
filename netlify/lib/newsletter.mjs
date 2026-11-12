// Shared helpers for the self-hosted newsletter list.
//
// Subscribers live in a Netlify Blobs store (free, built into Netlify), one
// JSON record per subscriber, keyed by a SHA-256 hash of their email so no
// email address ever appears in a URL or a blob key.
//
// Record shape:
//   { email, status: 'pending' | 'active' | 'unsubscribed', source,
//     createdAt, confirmSentAt?, confirmedAt?, unsubscribedAt? }
//
// Env vars (Netlify → Site configuration → Environment variables):
//   NEWSLETTER_SECRET       random string used to sign confirm/unsubscribe links
//   NEWSLETTER_ADMIN_TOKEN  random string the send script / import use to read
//                           and write the list via /api/subscribers
//   RESEND_API_KEY          to send confirmation emails
//   FROM_EMAIL              optional, defaults to "Charu <charu@veluthoor.com>"

import { getStore } from '@netlify/blobs';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const STORE_NAME = 'newsletter-subscribers';
export const FROM_DEFAULT = 'Charu <charu@veluthoor.com>';

export function store() {
  // Strong consistency so a confirm click right after signup sees the record.
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

export function normalizeEmail(raw) {
  const email = (raw || '').toString().trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && email.length <= 254 ? email : null;
}

export function idFor(email) {
  return createHash('sha256').update(email).digest('hex');
}

function secret() {
  const s = process.env.NEWSLETTER_SECRET;
  if (!s) throw new Error('NEWSLETTER_SECRET not configured');
  return s;
}

export function sign(purpose, id) {
  return createHmac('sha256', secret()).update(`${purpose}:${id}`).digest('base64url');
}

export function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function verify(purpose, id, token) {
  return /^[0-9a-f]{64}$/.test(id || '') && safeEqual(sign(purpose, id), token);
}

export function linkFor(origin, purpose, id) {
  const path = purpose === 'confirm' ? '/api/confirm' : '/api/unsubscribe';
  return `${origin}${path}?id=${id}&t=${sign(purpose, id)}`;
}

export function isAdmin(request) {
  const expected = process.env.NEWSLETTER_ADMIN_TOKEN;
  if (!expected) return false;
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return safeEqual(token, expected);
}

export async function getRecord(id) {
  return store().get(id, { type: 'json' });
}

export async function putRecord(record) {
  await store().setJSON(idFor(record.email), record);
}

// Every record in the store. Reads run in parallel chunks so this stays quick
// into the low thousands of subscribers.
export async function allRecords() {
  const s = store();
  const { blobs } = await s.list();
  const out = [];
  for (let i = 0; i < blobs.length; i += 50) {
    const chunk = await Promise.all(blobs.slice(i, i + 50).map(b => s.get(b.key, { type: 'json' })));
    out.push(...chunk.filter(Boolean));
  }
  return out;
}

export async function sendEmail({ to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY not configured');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.FROM_EMAIL || FROM_DEFAULT, to, subject, html, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

const escapeHtml = s =>
  String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// A tiny standalone page in the site's red-and-black style, for the
// confirm / unsubscribe / no-JS signup responses.
export function page(title, bodyHtml, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} — Charu Veluthoor</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fff;color:#000;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding:16px}
  main{max-width:480px;width:100%;border:3px solid #000;box-shadow:8px 8px 0 #FF0000;padding:32px 28px}
  h1{margin:0 0 12px;font-size:1.6rem;line-height:1.2}
  p{margin:0 0 16px;font-size:1.05rem;line-height:1.6}
  a{color:#FF0000;font-weight:700}
  button{font:inherit;font-weight:700;background:#FF0000;color:#fff;border:3px solid #000;padding:10px 18px;cursor:pointer}
</style></head><body><main><h1>${escapeHtml(title)}</h1>${bodyHtml}
<p><a href="https://veluthoor.com">← Back to veluthoor.com</a></p></main></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

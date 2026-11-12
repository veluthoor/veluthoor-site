// Private admin endpoint for the subscriber list. Requires
//   Authorization: Bearer <NEWSLETTER_ADMIN_TOKEN>
//
//   GET  /api/subscribers              active subscribers as JSON, each with a
//                                      signed unsubscribe link (used by the
//                                      newsletter send script)
//   GET  /api/subscribers?format=csv   every record as CSV, any status (your
//                                      own backup/export)
//   POST /api/subscribers              import { "emails": [...] } as active
//                                      subscribers (used once to move the list
//                                      over from MailerLite). Never re-adds
//                                      someone who has unsubscribed.

import { isAdmin, allRecords, normalizeEmail, idFor, getRecord, putRecord, linkFor } from '../lib/newsletter.mjs';

// Kept small so one request finishes well inside Netlify's function time limit.
const MAX_IMPORT = 100;

const csvCell = v => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export default async (request) => {
  if (!isAdmin(request)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);

  if (request.method === 'GET') {
    const records = await allRecords();

    if (url.searchParams.get('format') === 'csv') {
      const cols = ['email', 'status', 'source', 'createdAt', 'confirmedAt', 'unsubscribedAt'];
      const rows = records
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
        .map(r => cols.map(c => csvCell(r[c])).join(','));
      return new Response([cols.join(','), ...rows].join('\n') + '\n', {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="subscribers.csv"',
        },
      });
    }

    const subscribers = records
      .filter(r => r.status === 'active')
      .map(r => ({ email: r.email, unsubscribeUrl: linkFor(url.origin, 'unsubscribe', idFor(r.email)) }));
    return Response.json({ count: subscribers.length, subscribers });
  }

  if (request.method === 'POST') {
    let emails;
    try {
      ({ emails } = await request.json());
    } catch {
      emails = null;
    }
    if (!Array.isArray(emails) || emails.length > MAX_IMPORT) {
      return Response.json({ error: `send { "emails": [...] } with at most ${MAX_IMPORT} addresses` }, { status: 400 });
    }

    const result = { added: 0, activated: 0, alreadyActive: 0, skippedUnsubscribed: 0, invalid: 0 };
    const now = new Date().toISOString();
    const unique = new Set();
    for (const raw of emails) {
      const email = normalizeEmail(raw);
      if (email) unique.add(email);
      else result.invalid++;
    }

    const importOne = async (email) => {
      const existing = await getRecord(idFor(email));
      if (!existing) {
        await putRecord({ email, status: 'active', source: 'import', createdAt: now, confirmedAt: now });
        result.added++;
      } else if (existing.status === 'active') {
        result.alreadyActive++;
      } else if (existing.status === 'unsubscribed') {
        result.skippedUnsubscribed++;
      } else {
        await putRecord({ ...existing, status: 'active', confirmedAt: now });
        result.activated++;
      }
    };

    const list = [...unique];
    for (let i = 0; i < list.length; i += 25) {
      await Promise.all(list.slice(i, i + 25).map(importOne));
    }
    return Response.json(result);
  }

  return new Response('Method not allowed', { status: 405 });
};

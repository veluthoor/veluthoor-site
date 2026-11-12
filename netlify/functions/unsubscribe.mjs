// Unsubscribe link from each newsletter email.
//   GET  /api/unsubscribe?id=…&t=…  shows a page with an "Unsubscribe" button.
//        (Not instant, because email security scanners open links on their own
//        and would otherwise unsubscribe people who never clicked.)
//   POST /api/unsubscribe?id=…&t=…  unsubscribes immediately. This is both the
//        button above and the one-click "Unsubscribe" that Gmail and Apple Mail
//        show, which POSTs "List-Unsubscribe=One-Click" (RFC 8058).

import { verify, getRecord, putRecord, page } from '../lib/newsletter.mjs';

export default async (request) => {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const token = url.searchParams.get('t');

  if (!verify('unsubscribe', id, token)) {
    return page('That link doesn\'t look right', '<p>Email <a href="mailto:charu@veluthoor.com">charu@veluthoor.com</a> and I\'ll take you off the list myself.</p>', 400);
  }

  if (request.method === 'GET') {
    return page(
      'Unsubscribe?',
      `<p>You'll stop getting new posts by email.</p>
<form method="post" action="/api/unsubscribe?id=${id}&amp;t=${encodeURIComponent(token)}"><p><button type="submit">Unsubscribe</button></p></form>`
    );
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const record = await getRecord(id);
  if (record && record.status !== 'unsubscribed') {
    await putRecord({ ...record, status: 'unsubscribed', unsubscribedAt: new Date().toISOString() });
  }
  return page('You\'re unsubscribed', '<p>Sorry to see you go! You won\'t get any more emails from me.</p>');
};

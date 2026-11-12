// Double opt-in confirmation: the link in the signup email lands here.
// GET /api/confirm?id=<sha256 of email>&t=<signed token>

import { verify, getRecord, putRecord, page } from '../lib/newsletter.mjs';

export default async (request) => {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const token = url.searchParams.get('t');

  if (!verify('confirm', id, token)) {
    return page('That link doesn\'t look right', '<p>Try subscribing again from the site, and use the newest email I send you.</p>', 400);
  }

  const record = await getRecord(id);
  if (!record) {
    return page('That link has expired', '<p>Try subscribing again from the site.</p>', 404);
  }

  if (record.status === 'active') {
    return page('You\'re already subscribed', '<p>No need to do anything — new posts will land in your inbox.</p>');
  }

  // Only a pending signup can be confirmed. An old confirm link must not
  // quietly re-subscribe someone who has since unsubscribed.
  if (record.status !== 'pending') {
    return page('You\'re unsubscribed', '<p>If you\'d like to come back, subscribe again from the site.</p>');
  }

  await putRecord({ ...record, status: 'active', confirmedAt: new Date().toISOString() });
  return page('You\'re in!', '<p>Thanks for subscribing — new posts will land straight in your inbox :)</p>');
};

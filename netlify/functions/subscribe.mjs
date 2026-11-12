// Newsletter signup with double opt-in.
//
// The site form posts an email here (JSON from subscribe.js, or a plain form
// POST when JS is off). We store the subscriber as "pending" in our own Netlify
// Blobs list and email them a confirmation link. They only start receiving
// posts once they click it (see confirm.mjs).
//
// Spam protection: a hidden "website" field that people never fill but bots do,
// and at most one confirmation email per address every 10 minutes.

import { normalizeEmail, idFor, getRecord, putRecord, linkFor, sendEmail, page } from '../lib/newsletter.mjs';

const RESEND_COOLDOWN_MS = 10 * 60 * 1000;

function confirmationEmail(link) {
  return {
    subject: 'Confirm your subscription to Charu Veluthoor',
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a;font-size:16px;line-height:1.6">
<p>Hi!</p>
<p>Thanks for signing up to get my posts in your inbox. Just one click to confirm it was you:</p>
<p style="margin:28px 0"><a href="${link}" style="background:#FF0000;color:#fff;font-weight:700;text-decoration:none;padding:12px 20px;border:3px solid #000">Yes, subscribe me</a></p>
<p>If you didn't sign up, ignore this email and you won't hear from me.</p>
<p>— Charu</p>
</div>`,
    text: `Thanks for signing up to get my posts in your inbox.\n\nConfirm your subscription: ${link}\n\nIf you didn't sign up, ignore this email and you won't hear from me.\n\n— Charu`,
  };
}

export default async (request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const isJson = (request.headers.get('content-type') || '').includes('application/json');
  const reply = (ok, status = 200, error) =>
    isJson
      ? Response.json(ok ? { success: true } : { success: false, error }, { status })
      : ok
        ? page('Almost there!', '<p>Check your inbox for a confirmation link. Once you click it, you\'re subscribed.</p>')
        : page('Something went wrong', '<p>Please go back and try again, or email <a href="mailto:charu@veluthoor.com">charu@veluthoor.com</a>.</p>', status);

  let raw, honeypot;
  try {
    if (isJson) {
      ({ email: raw, website: honeypot } = await request.json());
    } else {
      const form = await request.formData();
      raw = form.get('email') || form.get('fields[email]');
      honeypot = form.get('website');
    }
  } catch {
    raw = null;
  }

  // Bots fill every field. Pretend it worked so they don't adapt.
  if (honeypot) return reply(true);

  const email = normalizeEmail(raw);
  if (!email) return reply(false, 400, 'invalid email');

  const id = idFor(email);
  const now = new Date();
  const existing = await getRecord(id);

  // Already subscribed: say yes, send nothing.
  if (existing?.status === 'active') return reply(true);

  // Pending and we emailed them very recently: don't send another.
  if (
    existing?.status === 'pending' &&
    existing.confirmSentAt &&
    now - new Date(existing.confirmSentAt) < RESEND_COOLDOWN_MS
  ) {
    return reply(true);
  }

  const record = {
    email,
    status: 'pending',
    source: existing?.source || 'form',
    createdAt: existing?.createdAt || now.toISOString(),
    confirmSentAt: now.toISOString(),
  };

  try {
    await sendEmail({ to: email, ...confirmationEmail(linkFor(new URL(request.url).origin, 'confirm', id)) });
  } catch (err) {
    console.error('confirmation email failed', err);
    return reply(false, 502, 'email_failed');
  }
  await putRecord(record);
  return reply(true);
};

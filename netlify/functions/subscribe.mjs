// Newsletter signup.
//
// The site form posts an email here (JSON from subscribe.js, or a plain form
// POST when JS is off). Two modes, picked by configuration:
//
// 1. Cloudflare Turnstile (when TURNSTILE_SECRET_KEY is set): the browser runs
//    Cloudflare's bot check and sends us a one-time token. We verify it with
//    Cloudflare using the secret key (which never leaves the server) and, if
//    it passes, add the subscriber as active immediately. No email to click.
//
// 2. Double opt-in (fallback when Turnstile isn't configured): we store the
//    subscriber as "pending" and email a confirmation link (see confirm.mjs).
//
// Both modes also have a hidden "website" field that people never fill but
// bots do.
//
// Env vars: TURNSTILE_SECRET_KEY (optional, enables mode 1). The matching
// public site key is PUBLIC_TURNSTILE_SITE_KEY, used at build time by the pages.

import { normalizeEmail, idFor, getRecord, putRecord, linkFor, sendEmail, page } from '../lib/newsletter.mjs';

const RESEND_COOLDOWN_MS = 10 * 60 * 1000;
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

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

async function passesTurnstile(token, ip) {
  if (!token) return false;
  const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: token });
  if (ip) body.set('remoteip', ip);
  try {
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body });
    const data = await res.json();
    if (!data.success) console.warn('turnstile rejected', data['error-codes']);
    return data.success === true;
  } catch (err) {
    console.error('turnstile verify failed', err);
    return false;
  }
}

export default async (request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const turnstileOn = !!process.env.TURNSTILE_SECRET_KEY;
  const isJson = (request.headers.get('content-type') || '').includes('application/json');

  // ok: success; pending: true when they still need to click a confirm email.
  const reply = ({ ok, pending = false, status = 200, error }) => {
    if (isJson) {
      return Response.json(ok ? { success: true, pending } : { success: false, error }, { status });
    }
    if (ok && pending) {
      return page('Almost there!', '<p>Check your inbox for a confirmation link. Once you click it, you\'re subscribed.</p>');
    }
    if (ok) {
      return page('You\'re in!', '<p>Thanks for subscribing — new posts will land straight in your inbox :)</p>');
    }
    const msg = error === 'verification_failed'
      ? '<p>We couldn\'t check you\'re not a bot. Please go back and try again with JavaScript turned on, or email <a href="mailto:charu@veluthoor.com">charu@veluthoor.com</a>.</p>'
      : '<p>Please go back and try again, or email <a href="mailto:charu@veluthoor.com">charu@veluthoor.com</a>.</p>';
    return page('Something went wrong', msg, status);
  };

  let raw, honeypot, token;
  try {
    if (isJson) {
      ({ email: raw, website: honeypot, token } = await request.json());
    } else {
      const form = await request.formData();
      raw = form.get('email') || form.get('fields[email]');
      honeypot = form.get('website');
      token = form.get('cf-turnstile-response');
    }
  } catch {
    raw = null;
  }

  // Bots fill every field. Pretend it worked so they don't adapt.
  if (honeypot) return reply({ ok: true, pending: !turnstileOn });

  const email = normalizeEmail(raw);
  if (!email) return reply({ ok: false, status: 400, error: 'invalid email' });

  const id = idFor(email);
  const now = new Date();

  // ---- Mode 1: Turnstile, instant signup ----
  if (turnstileOn) {
    const ip = request.headers.get('x-nf-client-connection-ip') || undefined;
    if (!(await passesTurnstile(token, ip))) {
      return reply({ ok: false, status: 400, error: 'verification_failed' });
    }
    const existing = await getRecord(id);
    if (existing?.status !== 'active') {
      await putRecord({
        email,
        status: 'active',
        source: existing?.source || 'form',
        createdAt: existing?.createdAt || now.toISOString(),
        confirmedAt: now.toISOString(),
      });
    }
    return reply({ ok: true });
  }

  // ---- Mode 2: double opt-in ----
  const existing = await getRecord(id);

  // Already subscribed: say yes, send nothing.
  if (existing?.status === 'active') return reply({ ok: true });

  // Pending and we emailed them very recently: don't send another.
  if (
    existing?.status === 'pending' &&
    existing.confirmSentAt &&
    now - new Date(existing.confirmSentAt) < RESEND_COOLDOWN_MS
  ) {
    return reply({ ok: true, pending: true });
  }

  try {
    await sendEmail({ to: email, ...confirmationEmail(linkFor(new URL(request.url).origin, 'confirm', id)) });
  } catch (err) {
    console.error('confirmation email failed', err);
    return reply({ ok: false, status: 502, error: 'email_failed' });
  }
  await putRecord({
    email,
    status: 'pending',
    source: existing?.source || 'form',
    createdAt: existing?.createdAt || now.toISOString(),
    confirmSentAt: now.toISOString(),
  });
  return reply({ ok: true, pending: true });
};

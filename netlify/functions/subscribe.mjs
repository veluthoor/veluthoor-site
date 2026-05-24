// Server-side subscribe proxy. The site form posts an email here; this calls
// MailerLite's API with the secret key (never exposed to the browser). With the
// account's "Double opt-in for API and integrations" turned OFF, subscribers
// are added as active immediately — no confirmation email.
//
// Env var (set in Netlify dashboard → Site settings → Environment variables):
//   MAILERLITE_API_KEY
// Optional:
//   MAILERLITE_GROUP_ID  — if set, new subscribers are added to this group.

const ML_URL = 'https://connect.mailerlite.com/api/subscribers';

export default async (request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let email;
  try {
    const ct = request.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      ({ email } = await request.json());
    } else {
      const form = await request.formData();
      // accept either "email" or MailerLite-style "fields[email]"
      email = form.get('email') || form.get('fields[email]');
    }
  } catch {
    email = null;
  }

  email = (email || '').toString().trim().toLowerCase();
  // minimal sanity check
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return Response.json({ success: false, error: 'invalid email' }, { status: 400 });
  }

  const key = process.env.MAILERLITE_API_KEY;
  if (!key) {
    return Response.json({ success: false, error: 'not configured' }, { status: 500 });
  }

  const body = { email };
  if (process.env.MAILERLITE_GROUP_ID) {
    body.groups = [process.env.MAILERLITE_GROUP_ID];
  }

  const res = await fetch(ML_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  // 201 = created, 200 = already existed (upsert). Both are "subscribed".
  if (res.ok) {
    return Response.json({ success: true });
  }

  const detail = await res.text();
  return Response.json(
    { success: false, error: 'mailerlite_error', detail },
    { status: 502 }
  );
};

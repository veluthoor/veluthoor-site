// Progressive enhancement for MailerLite subscribe forms.
// Without JS the form still POSTs (target=_blank) and works; with JS we submit
// in the background and show an inline thank-you so the page never navigates
// to MailerLite's raw {"success":true} response.
//
// Note: the MailerLite jsonp endpoint sends no CORS headers, so we use
// mode:'no-cors' — the request goes through and the subscriber is added, but
// the response is opaque (unreadable). We treat "no network error" as success,
// which is the standard pattern for these endpoints.
(function () {
  function enhance(form) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      const emailInput = form.querySelector('input[type="email"]');
      const original = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Subscribing…'; }

      try {
        await fetch(form.action, {
          method: 'POST',
          mode: 'no-cors',
          body: new FormData(form),
        });
        // Replace the form with a thank-you message, matching site tone.
        const msg = document.createElement('p');
        msg.className = 'subscribe-thanks';
        msg.textContent = "You're in! Thanks for subscribing — see you in your inbox :)";
        msg.style.cssText = 'margin:0;font-weight:500;';
        form.replaceWith(msg);
      } catch (err) {
        if (btn) { btn.disabled = false; btn.textContent = original; }
        alert('Something went wrong — please try again, or email charu@veluthoor.com.');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    document
      .querySelectorAll('.subscribe-form, .post-subscribe-form')
      .forEach(enhance);
  });
})();

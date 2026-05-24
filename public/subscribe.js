// Progressive enhancement for the subscribe forms.
// Submits in the background to our own /api/subscribe Netlify function, which
// adds the subscriber to MailerLite via the API (no double opt-in, since the
// account's API double opt-in is off). Shows an inline thank-you so the page
// never navigates away. If JS is unavailable the form still POSTs directly to
// MailerLite as a fallback (just lands on their plain response page).
(function () {
  var ENDPOINT = '/api/subscribe';

  function enhance(form) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      var emailInput = form.querySelector('input[type="email"]');
      var email = emailInput ? emailInput.value.trim() : '';
      var original = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Subscribing…'; }

      try {
        var res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email }),
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.success) throw new Error('subscribe failed');

        var msg = document.createElement('p');
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

// Progressive enhancement for the subscribe forms.
// Submits in the background to our own /api/subscribe Netlify function and
// shows an inline note so the page never navigates away.
//
// If the page has a Cloudflare Turnstile widget (.cf-turnstile, right after the
// form), we wait for its one-time token and send it along; the function checks
// it with Cloudflare and subscribes the person instantly. Without Turnstile the
// function emails a confirmation link instead, and the note says so.
//
// If JS is unavailable the form still POSTs to the same endpoint, which replies
// with a simple page instead.
(function () {
  var ENDPOINT = '/api/subscribe';

  function widgetFor(form) {
    var next = form.nextElementSibling;
    return next && next.classList.contains('cf-turnstile') ? next : null;
  }

  // Turnstile usually has a token ready within a second or two of page load.
  // Wait up to ~8s for it in case someone submits very quickly.
  async function turnstileToken(widget) {
    for (var i = 0; i < 80; i++) {
      var input = widget.querySelector('input[name="cf-turnstile-response"]');
      if (input && input.value) return input.value;
      await new Promise(function (r) { setTimeout(r, 100); });
    }
    return '';
  }

  function enhance(form) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      var emailInput = form.querySelector('input[type="email"]');
      var email = emailInput ? emailInput.value.trim() : '';
      var trap = form.querySelector('input[name="website"]');
      var widget = widgetFor(form);
      var original = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Subscribing…'; }

      try {
        var token = widget ? await turnstileToken(widget) : '';
        var res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, website: trap ? trap.value : '', token: token }),
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.success) throw new Error(data.error || 'subscribe failed');

        var msg = document.createElement('p');
        msg.className = 'subscribe-thanks';
        msg.textContent = data.pending
          ? "Almost there! Check your inbox for a confirmation link — once you click it, you're in :)"
          : "You're in! Thanks for subscribing — see you in your inbox :)";
        msg.style.cssText = 'margin:0;font-weight:500;';
        if (widget) widget.remove();
        form.replaceWith(msg);
      } catch (err) {
        if (btn) { btn.disabled = false; btn.textContent = original; }
        // Tokens are single-use: get a fresh one for the next attempt.
        if (widget && window.turnstile) window.turnstile.reset(widget);
        alert(err.message === 'verification_failed'
          ? "Sorry, we couldn't confirm you're not a bot. Please try again in a moment."
          : 'Something went wrong — please try again, or email charu@veluthoor.com.');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    document
      .querySelectorAll('.subscribe-form, .post-subscribe-form')
      .forEach(enhance);
  });
})();

// Progressive enhancement for the subscribe forms.
// Submits in the background to our own /api/subscribe Netlify function, which
// stores the subscriber in our self-hosted list and emails them a confirmation
// link (double opt-in). Shows an inline "check your inbox" note so the page
// never navigates away. If JS is unavailable the form still POSTs to the same
// endpoint, which replies with a simple page instead.
(function () {
  var ENDPOINT = '/api/subscribe';

  function enhance(form) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      var emailInput = form.querySelector('input[type="email"]');
      var email = emailInput ? emailInput.value.trim() : '';
      var trap = form.querySelector('input[name="website"]');
      var original = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Subscribing…'; }

      try {
        var res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, website: trap ? trap.value : '' }),
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.success) throw new Error('subscribe failed');

        var msg = document.createElement('p');
        msg.className = 'subscribe-thanks';
        msg.textContent = "Almost there! Check your inbox for a confirmation link — once you click it, you're in :)";
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

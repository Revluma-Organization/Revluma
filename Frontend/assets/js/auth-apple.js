/*
 * Sign in with Apple button, shared by login.html and signup.html.
 *
 *   window.initAppleButton(button, {
 *     onStart(),                 // popup confirmed, request in flight
 *     onSuccess(user),           // signed in (account created or existing)
 *     onLinkRequired(error),     // email already has an account; error.appleAuthorization
 *     onError(message, error),   // anything else; cancelled popups are silent
 *   });
 *
 * The button stays hidden unless the backend reports Apple as configured, so
 * there is never a broken button in production.
 */
(function () {
  'use strict';

  function initAppleButton(button, handlers) {
    if (!button || !window.revlumaAuth) return;
    const on = handlers || {};

    window.revlumaAuth.getAppleConfig().then(function (config) {
      if (!config.enabled) return;
      button.hidden = false;
      // Warm the script so the popup opens straight from the click (popup blockers).
      window.revlumaAuth._loadAppleJs().catch(function () {});
    });

    button.addEventListener('click', async function () {
      if (button.getAttribute('aria-busy') === 'true') return;
      button.setAttribute('aria-busy', 'true');
      try {
        const authorization = await window.revlumaAuth.appleAuthorize();
        if (on.onStart) await on.onStart();
        const result = await window.revlumaAuth.appleLogin({ authorization: authorization, terms_agreed: true });
        const data = result.data || result;
        if (on.onSuccess) on.onSuccess(data.user || null);
      } catch (error) {
        if (error && error.code === 'APPLE_CANCELLED') return;
        if (error && error.code === 'APPLE_ACCOUNT_LINK_REQUIRED' && on.onLinkRequired) {
          on.onLinkRequired(error);
          return;
        }
        if (on.onError) on.onError((error && error.message) || 'Apple sign-in failed. Please try again.', error);
      } finally {
        button.removeAttribute('aria-busy');
      }
    });
  }

  window.initAppleButton = initAppleButton;
})();

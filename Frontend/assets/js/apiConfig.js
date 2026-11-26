(function () {
  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  // Local backend typically uses PORT=8000 so it does not collide with Vite (8080).
  window.REVLUMA_API_BASE = isLocal
    ? 'http://localhost:8000/api/v1'
    : 'https://revluma-backend-lqve.onrender.com/api/v1';
})();

window.REVLUMA_GOOGLE_CLIENT_ID = '137716714187-75iq86blnhp09hcg7spvhspgath32eol.apps.googleusercontent.com';

// The Founding Merchants application (/waitlist) talks to the backend through
// the same-origin proxy in api/waitlist/application.js, not from here.

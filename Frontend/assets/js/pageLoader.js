/**
 * Page Transition Loader
 * This is a multi-page site (not a single-page app outside the
 * /dashboard React app), so every "Get Started", nav link, or "Back"
 * click causes a real full-page navigation. On a slow connection —
 * especially mobile — there's a dead gap between the click and the next
 * page actually painting, with zero feedback that anything happened.
 * That's exactly what this fixes: the instant a navigating click (or a
 * JS-driven redirect) fires, a full-screen glassmorphism spinner appears,
 * so the person always knows something is loading.
 *
 * Deliberately dependency-free (no fetch, no external component load)
 * so it works identically no matter how deep the page sits in the
 * folder structure, and can't fail due to a relative-path mismatch.
 *
 * Usage: include this script on every non-dashboard page. It wires
 * itself up automatically. For any custom JS-driven redirect (e.g.
 * after an async action completes), call window.showPageLoader()
 * manually before navigating.
 */
(function () {
  if (window.__revlumaPageLoaderInit) return;
  window.__revlumaPageLoaderInit = true;

  const STYLE_ID = 'rv-page-loader-styles';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #rv-page-loader {
        position: fixed;
        inset: 0;
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.72);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transition: opacity 0.16s ease;
      }
      #rv-page-loader.rv-visible {
        opacity: 1;
        visibility: visible;
        pointer-events: all;
      }
      #rv-page-loader .rv-loader-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        padding: 28px 34px;
        border-radius: 18px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.06);
        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4);
        transform: scale(0.96) translateY(8px);
        transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }
      #rv-page-loader.rv-visible .rv-loader-card {
        transform: scale(1) translateY(0);
      }
      #rv-page-loader .rv-spinner {
        width: 40px;
        height: 40px;
        border: 3px solid rgba(255, 255, 255, 0.15);
        border-top-color: #ffffff;
        border-radius: 50%;
        animation: rv-spin 0.75s linear infinite;
      }
      #rv-page-loader .rv-loader-text {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'DM Sans', sans-serif;
        font-size: 0.8rem;
        font-weight: 600;
        letter-spacing: 0.02em;
        color: rgba(255, 255, 255, 0.85);
      }
      @keyframes rv-spin {
        to { transform: rotate(360deg); }
      }
      @media (prefers-reduced-motion: reduce) {
        #rv-page-loader .rv-spinner { animation-duration: 1.4s; }
      }
    `;
    document.head.appendChild(style);
  }

  function buildOverlay() {
    if (document.getElementById('rv-page-loader')) return;
    const overlay = document.createElement('div');
    overlay.id = 'rv-page-loader';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.innerHTML =
      '<div class="rv-loader-card">' +
      '<div class="rv-spinner" aria-hidden="true"></div>' +
      '<span class="rv-loader-text">Loading…</span>' +
      '</div>';
    document.body.appendChild(overlay);
  }

  // Build immediately if body already exists (script placed near end of
  // body), otherwise wait for DOMContentLoaded (script placed in head).
  if (document.body) {
    buildOverlay();
  } else {
    document.addEventListener('DOMContentLoaded', buildOverlay);
  }

  window.showPageLoader = function (label) {
    buildOverlay();
    const overlay = document.getElementById('rv-page-loader');
    if (!overlay) return;
    if (label) {
      const textEl = overlay.querySelector('.rv-loader-text');
      if (textEl) textEl.textContent = label;
    }
    overlay.classList.add('rv-visible');
  };

  window.hidePageLoader = function () {
    const overlay = document.getElementById('rv-page-loader');
    if (overlay) overlay.classList.remove('rv-visible');
  };

  // Guard against the overlay getting stuck visible if a page is restored
  // from the back/forward cache (bfcache) mid-navigation.
  window.addEventListener('pageshow', function () {
    window.hidePageLoader();
  });

  function isNavigatingAway(url) {
    return url.origin === window.location.origin &&
      !(url.pathname === window.location.pathname && url.hash);
  }

  // Auto-intercept plain same-origin link clicks across the whole page —
  // covers "Get Started", nav links, footer links, etc. with zero markup
  // changes needed on any individual page. Capturing phase so this always
  // runs before any inline onclick handler on the same element.
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    const link = e.target.closest('a[href]');
    if (link) {
      const href = link.getAttribute('href') || '';
      if (
        href.startsWith('#') ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:') ||
        href.startsWith('javascript:') ||
        link.hasAttribute('download') ||
        (link.target && link.target !== '_self')
      ) {
        return;
      }
      let url;
      try {
        url = new URL(href, window.location.href);
      } catch (err) {
        return;
      }
      if (isNavigatingAway(url)) {
        window.showPageLoader();
      }
      return;
    }

    // Buttons/elements using an inline onclick that navigates directly
    // (a common pattern in this codebase, e.g. "Back" buttons using
    // window.location.href or window.history.back()).
    const navEl = e.target.closest('[onclick]');
    if (navEl) {
      const onclickAttr = navEl.getAttribute('onclick') || '';
      if (/window\.location|window\.history\.(back|forward|go)/.test(onclickAttr)) {
        window.showPageLoader();
      }
    }
  }, true);
})();
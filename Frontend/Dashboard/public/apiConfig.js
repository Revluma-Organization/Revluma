(function () {
    const sanitizeUrl = url => typeof url === 'string' ? url.replace(/\/$/, '') : url;

    const prodBackendUrl = 'https://revluma.onrender.com/api';
    const isProduction = window.location.hostname === 'revluman.vercel.app' || window.location.hostname.endsWith('vercel.app');

    const envOverride = window.APP_API_BASE && typeof window.APP_API_BASE === 'string'
        ? sanitizeUrl(window.APP_API_BASE.trim())
        : null;

    const isFileProtocol = window.location.protocol === 'file:';
    const origin = window.location.origin || '';
    const sameOriginFallback = (!origin || isFileProtocol)
        ? 'http://localhost:5000/api'
        : `${origin}/api`;

    const apiBase = envOverride || (isProduction ? prodBackendUrl : sameOriginFallback);

    window.APP_API_BASE = apiBase;
    window.REVLUMA_CONFIG = window.REVLUMA_CONFIG || {};
    window.REVLUMA_CONFIG.apiBase = apiBase;
    window.REVLUMA_CONFIG.mode = envOverride ? 'override' : (isProduction ? 'production' : 'development');

    if (!envOverride && !isProduction) {
        console.info('Revluma Dashboard API using same-origin fallback:', apiBase);
    }
})();

(function () {
    const sanitizeUrl = url => typeof url === 'string' ? url.replace(/\/$/, '') : url;

    const prodBackendUrl = 'https://revluma.onrender.com/api';
    const hostname = (window.location.hostname || '').toLowerCase();
    const isVercelHost = hostname.endsWith('.vercel.app') || hostname.endsWith('.vercel.sh');
    const isRenderHost = hostname === 'revluma.onrender.com' || hostname.endsWith('.revluma.onrender.com');
    const isCustomDomain = hostname === 'revluma.com' || hostname.endsWith('.revluma.com');
    const isRevlumaHost = hostname.includes('revluma');
    const isProduction = isRenderHost || (isVercelHost && isRevlumaHost) || isCustomDomain;

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

    console.info('Revluma Dashboard API runtime config:', {
        host: window.location.hostname,
        protocol: window.location.protocol,
        appApiBase: window.APP_API_BASE,
        envOverride: !!envOverride,
        mode: window.REVLUMA_CONFIG.mode,
        productionHost: isProduction,
        prodBackendUrl
    });

    if (envOverride) {
        console.info('Revluma Dashboard API base overridden:', apiBase);
    } else if (isProduction) {
        console.info('Revluma Dashboard API base (production):', apiBase);
    } else {
        console.info('Revluma Dashboard API using same-origin fallback:', apiBase);
    }
})();

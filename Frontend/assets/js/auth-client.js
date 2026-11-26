class RevlumaAuth {
    constructor() {
        this.apiBase = window.REVLUMA_API_BASE || 'https://revluma-backend-lqve.onrender.com/api/v1';
        this.loginPath = '/auth/login.html';
    }

    async register(payload) {
        const response = await fetch(`${this.apiBase}/auth/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (!response.ok || result.success !== true) {
            let errorMsg = result.error || result.message || 'Registration failed';
            if (result.errors && Array.isArray(result.errors)) {
                errorMsg = result.errors.join(', ');
            }
            console.error('Backend validation error data:', result);

            const simulatedAxiosError = new Error(errorMsg);
            simulatedAxiosError.code = result.code || undefined;
            simulatedAxiosError.action = result.action || undefined;
            simulatedAxiosError.response = { data: result };
            throw simulatedAxiosError;
        }

        const tokenData = result.data || result;
        this._storeTokens(
            tokenData.access_token || tokenData.accessToken || tokenData.token,
            tokenData.user
        );
        return result;
    }

    async verificationRequest(path, payload) {
        if (!this.apiBase) throw new Error('Authentication API is not configured.');
        const response = await fetch(this.apiBase + path, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok || result.success !== true) {
            throw new Error(result.error || result.message || 'Verification request failed.');
        }
        // Verification confirms an email; it does not establish a login session.
        return result;
    }

    verifyEmail(email, code) {
        return this.verificationRequest('/auth/verify-email', { email, code });
    }

    resendVerification(email) {
        return this.verificationRequest('/auth/resend-verification', { email });
    }

    async login(email, password) {
        const response = await fetch(`${this.apiBase}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({
                account: {
                    email: email,
                    password: password
                }
            })
        });

        const result = await response.json();

        if (!response.ok || result.success !== true) {
            let errorMsg = result.error || result.message || 'Login failed';
            if (result.errors && Array.isArray(result.errors)) {
                errorMsg = result.errors.join(', ');
            }
            console.error('Backend validation error data:', result);

            const simulatedAxiosError = new Error(errorMsg);
            simulatedAxiosError.response = { data: result };
            throw simulatedAxiosError;
        }

        const tokenData = result.data || result;

        // --- PHASE 1: 2FA INTERCEPTION ---
        if (tokenData.requires_2fa) {
            return {
                requires2FA: true,
                tempToken: tokenData.temp_token || tokenData.access_token
            };
        }

        // --- STANDARD FLOW (No 2FA) ---
        this._storeTokens(
            tokenData.access_token || tokenData.accessToken || tokenData.token,
            tokenData.user
        );
        return result;
    }

    async verify2FA(code, tempToken, trustDevice = true) {
        const response = await fetch(`${this.apiBase}/auth/2fa/verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tempToken}`
            },
            credentials: 'include',
            body: JSON.stringify({
                code: code,
                trust_device: trustDevice
            })
        });

        const result = await response.json();

        if (!response.ok || result.success !== true) {
            let errorMsg = result.error || result.message || 'Invalid 2FA code';
            if (result.errors && Array.isArray(result.errors)) {
                errorMsg = result.errors.join(', ');
            }
            console.error('2FA Verification error data:', result);

            const simulatedAxiosError = new Error(errorMsg);
            simulatedAxiosError.response = { data: result };
            throw simulatedAxiosError;
        }

        // --- FINAL LOGIN (Tokens received) ---
        const tokenData = result.data || result;
        this._storeTokens(
            tokenData.access_token || tokenData.accessToken || tokenData.token,
            tokenData.user
        );
        return result;
    }

    // --- GOOGLE IDENTITY SERVICES FLOW ---
    // The pages show "By continuing with Google or Apple, you agree to the
    // Terms and Privacy Policy" next to the buttons, so consent defaults to true.
    // Store details are collected by onboarding, not invented here.
    async googleLogin(credential, options = {}) {
        const payload = {
            credential: credential,
            terms_agreed: options.terms_agreed ?? true,
            ...(options.organization ? { organization: options.organization } : {}),
        };

        const response = await fetch(`${this.apiBase}/auth/google`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (!response.ok || result.success !== true) {
            if (response.status === 409 && result.code === 'GOOGLE_ACCOUNT_LINK_REQUIRED') {
                const linkError = new Error('This Google account is already registered with email/password. Please log in with your password first to link Google.');
                linkError.code = 'GOOGLE_ACCOUNT_LINK_REQUIRED';
                throw linkError;
            }

            const errorMsg = result.error || result.message || 'Google authentication failed';
            const error = new Error(errorMsg);
            error.response = { data: result };
            throw error;
        }

        const tokenData = result.data || result;
        this._storeTokens(
            tokenData.access_token || tokenData.accessToken || tokenData.token,
            tokenData.user
        );
        return result;
    }

    async linkGoogleAccount(credential) {
        const token = this.getStoredToken();
        const response = await fetch(`${this.apiBase}/auth/google/link`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            credentials: 'include',
            body: JSON.stringify({ credential })
        });

        const result = await response.json();
        if (!response.ok || result.success !== true) {
            throw new Error(result.error || result.message || 'Failed to link Google account');
        }
        return result;
    }

    async linkGoogle(credential) {
        return this.linkGoogleAccount(credential);
    }

    // --- SIGN IN WITH APPLE (Apple JS, popup mode) ---
    // The backend decides whether Apple is available (GET /auth/apple/config),
    // so the button appears as soon as APPLE_CLIENT_ID is set on the server.
    getAppleConfig() {
        if (!this._appleConfig) {
            this._appleConfig = fetch(`${this.apiBase}/auth/apple/config`, { credentials: 'omit' })
                .then((response) => (response.ok ? response.json() : null))
                .then((result) => (result && result.data && result.data.enabled ? result.data : { enabled: false }))
                .catch(() => ({ enabled: false }));
        }
        return this._appleConfig;
    }

    _loadAppleJs() {
        if (window.AppleID && window.AppleID.auth) return Promise.resolve();
        if (!this._appleJs) {
            this._appleJs = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
                script.async = true;
                script.onload = () => (window.AppleID && window.AppleID.auth ? resolve() : reject(new Error('Apple sign-in did not load.')));
                script.onerror = () => { this._appleJs = null; reject(new Error('Apple sign-in could not load. Check your connection and try again.')); };
                document.head.appendChild(script);
            });
        }
        return this._appleJs;
    }

    _randomHex(bytes) {
        const values = new Uint8Array(bytes);
        window.crypto.getRandomValues(values);
        return Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('');
    }

    async _sha256Hex(text) {
        const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
    }

    // Opens Apple's popup. Resolves { id_token, nonce, user } where nonce is the
    // raw value; Apple only ever sees its SHA-256, and the server checks both.
    async appleAuthorize() {
        const config = await this.getAppleConfig();
        if (!config.enabled) {
            const error = new Error('Sign in with Apple is not available right now.');
            error.code = 'APPLE_NOT_CONFIGURED';
            throw error;
        }
        await this._loadAppleJs();
        const nonce = this._randomHex(32);
        const state = this._randomHex(16);
        window.AppleID.auth.init({
            clientId: config.client_id,
            scope: config.scope || 'name email',
            redirectURI: config.redirect_uri,
            state,
            nonce: await this._sha256Hex(nonce),
            usePopup: true,
        });
        let response;
        try {
            response = await window.AppleID.auth.signIn();
        } catch (failure) {
            const reason = failure && failure.error;
            const error = new Error(reason === 'popup_blocked_by_browser'
                ? 'Your browser blocked the Apple window. Allow pop-ups for this site and try again.'
                : 'Apple sign-in was cancelled.');
            error.code = reason === 'popup_closed_by_user' || reason === 'user_cancelled_authorize' ? 'APPLE_CANCELLED' : 'APPLE_FAILED';
            throw error;
        }
        const authorization = response && response.authorization;
        if (!authorization || !authorization.id_token || authorization.state !== state) {
            const error = new Error('Apple sign-in could not be confirmed. Please try again.');
            error.code = 'APPLE_FAILED';
            throw error;
        }
        return { id_token: authorization.id_token, nonce, user: response.user || null };
    }

    async appleLogin(options = {}) {
        const authorization = options.authorization || await this.appleAuthorize();
        const response = await fetch(`${this.apiBase}/auth/apple`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                id_token: authorization.id_token,
                nonce: authorization.nonce,
                user: authorization.user || undefined,
                terms_agreed: options.terms_agreed ?? true,
            }),
        });
        const result = await response.json();
        if (!response.ok || result.success !== true) {
            const error = new Error(result.error || result.message || 'Apple sign-in failed.');
            error.code = result.code;
            // Kept so the page can link this Apple ID after a password sign-in.
            if (result.code === 'APPLE_ACCOUNT_LINK_REQUIRED') error.appleAuthorization = authorization;
            throw error;
        }
        const tokenData = result.data || result;
        this._storeTokens(tokenData.access_token || tokenData.accessToken || tokenData.token, tokenData.user);
        return result;
    }

    async linkApple(authorization) {
        const result = await this.authorizedRequest('POST', '/auth/apple/link', {
            id_token: authorization.id_token,
            nonce: authorization.nonce,
        });
        return result;
    }

    // --- AUTHENTICATED JSON REQUESTS (one silent refresh on 401) ---
    async authorizedRequest(method, path, body) {
        const send = async () => {
            const token = this.getStoredToken();
            return fetch(`${this.apiBase}${path}`, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                credentials: 'include',
                body: body === undefined ? undefined : JSON.stringify(body),
            });
        };
        let response = await send();
        if (response.status === 401 && await this.refreshToken()) response = await send();
        let result = {};
        try { result = await response.json(); } catch { result = {}; }
        if (!response.ok || result.success !== true) {
            const error = new Error(result.error || result.message || 'Request failed. Please try again.');
            error.status = response.status;
            error.code = result.code;
            error.field = result.field;
            throw error;
        }
        return result;
    }

    // --- ONBOARDING (saved to the server as each step completes) ---
    getOnboarding() {
        return this.authorizedRequest('GET', '/onboarding');
    }

    saveOnboardingStore(store) {
        return this.authorizedRequest('PUT', '/onboarding/store', {
            store_name: store.store_name,
            store_url: store.store_url,
            store_category: store.store_category,
            monthly_orders: store.monthly_orders,
        });
    }

    async saveOnboardingGoals(goals) {
        const result = await this.authorizedRequest('PUT', '/onboarding/goals', { goals });
        const user = this.getUser();
        if (user) this._updateStoredUser({ ...user, onboarding_completed: true });
        return result;
    }

    _updateStoredUser(user) {
        for (const storage of [localStorage, sessionStorage]) {
            try {
                const raw = storage.getItem('rv-auth');
                if (!raw) continue;
                const parsed = JSON.parse(raw);
                parsed.state = { ...(parsed.state || {}), user };
                storage.setItem('rv-auth', JSON.stringify(parsed));
            } catch {
                // ignore
            }
        }
    }

    // Where a freshly signed-in user should land.
    destinationAfterSignIn(user) {
        return user && user.onboarding_completed === false ? '/auth/onboarding.html' : '/dashboard/overview';
    }

    // --- SILENT TOKEN REFRESH ---
    async refreshToken() {
        try {
            const response = await fetch(`${this.apiBase}/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ organization_id: this.getUser()?.tenant_id || this.getUser()?.active_organization_id || undefined })
            });

            const result = await response.json();
            if (!response.ok || result.success !== true) {
                this.clearStoredToken();
                return null;
            }

            const tokenData = result.data || result;
            const newAccessToken = tokenData.access_token || tokenData.accessToken;
            if (newAccessToken) {
                const currentUser = tokenData.user || this.getUser();
                this._storeTokens(newAccessToken, currentUser ? {
                    ...currentUser,
                    active_organization_id: tokenData.active_organization_id ?? null,
                    tenant_id: tokenData.active_organization_id || '',
                    role: tokenData.role || 'unknown'
                } : null);
                return newAccessToken;
            }
            return null;
        } catch {
            return null;
        }
    }

    async logout() {
        const token = this.getStoredToken();
        try {
            await fetch(`${this.apiBase}/auth/logout`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                credentials: 'include'
            });
        } catch (e) {
            console.warn('Backend logout failed or was unreachable', e);
        } finally {
            this.clearStoredToken();
            this._broadcastLogout();
            window.location.replace(this.loginPath);
        }
    }

    _storeTokens(accessToken, user) {
        if (accessToken) {
            const authState = {
                state: {
                    user: user || null,
                    csrfToken: accessToken,
                    accessToken: accessToken,
                },
                version: 0
            };
            localStorage.setItem('rv-auth', JSON.stringify(authState));
        }
    }

    getStoredToken() {
        try {
            for (const storage of [localStorage, sessionStorage]) {
                const authStr = storage.getItem('rv-auth');
                if (!authStr) continue;
                const parsed = JSON.parse(authStr);
                const token = parsed?.state?.accessToken || parsed?.state?.csrfToken || null;
                if (token) return token;
            }
        } catch {
            return null;
        }
        return null;
    }

    getUser() {
        try {
            for (const storage of [localStorage, sessionStorage]) {
                const authStr = storage.getItem('rv-auth');
                if (!authStr) continue;
                const parsed = JSON.parse(authStr);
                if (parsed?.state?.user) return parsed.state.user;
            }
        } catch {
            return null;
        }
        return null;
    }

    clearStoredToken() {
        const keys = [
            'rv-auth',
            'revluma_refresh_token',
            'revluma_token',
            'revluma_user',
            'revluma_pending_token',
        ];
        keys.forEach((key) => {
            try {
                localStorage.removeItem(key);
                sessionStorage.removeItem(key);
            } catch {
                // ignore
            }
        });
    }

    _broadcastLogout() {
        try {
            if (typeof BroadcastChannel !== 'undefined') {
                const channel = new BroadcastChannel('revluma-auth');
                channel.postMessage({ type: 'logout', at: Date.now() });
                channel.close();
            }
        } catch {
            // ignore
        }
        try {
            localStorage.setItem(
                'revluma_auth_event',
                JSON.stringify({ type: 'logout', at: Date.now() })
            );
            localStorage.removeItem('revluma_auth_event');
        } catch {
            // ignore
        }
    }

    isAuthenticated() {
        return !!this.getStoredToken();
    }

    hasRole(role) {
        const user = this.getUser();
        return user && user.role === role;
    }

    isAdmin() {
        return this.hasRole('admin') || this.hasRole('owner');
    }

    isEmailVerified() {
        const user = this.getUser();
        return user && user.email_verified === true;
    }

    getTenantId() {
        const user = this.getUser();
        return user ? user.tenant_id : null;
    }

    async requestPasswordReset(email) {
        const response = await fetch(`${this.apiBase}/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const result = await response.json();
        if (!response.ok || result.success !== true) {
            throw new Error(result.error || result.message || 'Password reset failed');
        }
        return result;
    }
}

window.revlumaAuth = new RevlumaAuth();
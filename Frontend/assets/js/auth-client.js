class RevlumaAuth {
    constructor() {
        this.apiBase = window.REVLUMA_API_BASE || 'https://revluma-backend.onrender.com/api/v1';
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

        if (!response.ok) {
            let errorMsg = result.error || result.message || 'Registration failed';
            if (result.errors && Array.isArray(result.errors)) {
                errorMsg = result.errors.join(', ');
            }
            console.error('Backend validation error data:', result);

            const simulatedAxiosError = new Error(errorMsg);
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

        if (!response.ok) {
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

        if (!response.ok) {
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
    async googleLogin(credential, options = {}) {
        const payload = {
            credential: credential,
            terms_agreed: options.terms_agreed ?? true,
            organization: options.organization || {
                brand_name: "Store",
                storeUrl: "",
                storeCategory: "General",
                country: "NG",
                state: "Lagos"
            },
            preferences: options.preferences || {
                monthlyRevenue: "0-10k"
            }
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

        if (!response.ok) {
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
        if (!response.ok) {
            throw new Error(result.error || result.message || 'Failed to link Google account');
        }
        return result;
    }

    async linkGoogle(credential) {
        return this.linkGoogleAccount(credential);
    }

    // --- SILENT TOKEN REFRESH ---
    async refreshToken() {
        try {
            const response = await fetch(`${this.apiBase}/auth/refresh`, {
                method: 'POST',
                credentials: 'include'
            });

            const result = await response.json();
            if (!response.ok) {
                this.clearStoredToken();
                return null;
            }

            const tokenData = result.data || result;
            const newAccessToken = tokenData.access_token || tokenData.accessToken;
            if (newAccessToken) {
                this._storeTokens(newAccessToken, tokenData.user || this.getUser());
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
        const response = await fetch(`${this.apiBase}/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        if (!response.ok) {
            const result = await response.json();
            throw new Error(result.error || result.message || 'Password reset failed');
        }
        return { success: true };
    }
}

window.revlumaAuth = new RevlumaAuth();
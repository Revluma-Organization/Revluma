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
            tokenData.refresh_token || tokenData.refreshToken,
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
        this._storeTokens(
            tokenData.access_token || tokenData.accessToken || tokenData.token,
            tokenData.refresh_token || tokenData.refreshToken,
            tokenData.user
        );
        return result;
    }

    async logout() {
        const token = this.getStoredToken();
        const refreshToken = this.getStoredRefreshToken();
        try {
            await fetch(`${this.apiBase}/auth/logout`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                credentials: 'include',
                body: JSON.stringify({ refresh_token: refreshToken }),
            });
        } catch (e) {
            console.warn('Backend logout failed or was unreachable', e);
        } finally {
            this.clearStoredToken();
            this._broadcastLogout();
            window.location.replace(this.loginPath);
        }
    }

    _storeTokens(accessToken, refreshToken, user) {
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
        if (refreshToken) {
            localStorage.setItem('revluma_refresh_token', refreshToken);
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
        } catch (e) {
            return null;
        }
        return null;
    }

    getStoredRefreshToken() {
        try {
            return (
                localStorage.getItem('revluma_refresh_token') ||
                sessionStorage.getItem('revluma_refresh_token')
            );
        } catch (e) {
            return null;
        }
    }

    getUser() {
        try {
            for (const storage of [localStorage, sessionStorage]) {
                const authStr = storage.getItem('rv-auth');
                if (!authStr) continue;
                const parsed = JSON.parse(authStr);
                if (parsed?.state?.user) return parsed.state.user;
            }
        } catch (e) {
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
            } catch (e) {
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
        } catch (e) {
            // ignore
        }
        try {
            localStorage.setItem(
                'revluma_auth_event',
                JSON.stringify({ type: 'logout', at: Date.now() })
            );
            localStorage.removeItem('revluma_auth_event');
        } catch (e) {
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

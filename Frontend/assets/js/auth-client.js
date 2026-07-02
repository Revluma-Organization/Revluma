class RevlumaAuth {
    constructor() {
        this.apiBase = window.REVLUMA_API_BASE || 'http://localhost:8000/api/v1';
    }

    async register(payload) {
        const response = await fetch(`${this.apiBase}/auth/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || result.message || 'Registration failed');
        }

        this._storeTokens(result.accessToken || result.token, result.refreshToken, result.user);
        return result;
    }

    async login(email, password) {
        const response = await fetch(`${this.apiBase}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                account: {
                    email: email,
                    password: password
                }
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || result.message || 'Login failed');
        }

        this._storeTokens(result.accessToken || result.token, result.refreshToken, result.user);
        return result;
    }

    async logout() {
        try {
            const token = this.getStoredToken();
            if (token) {
                await fetch(`${this.apiBase}/auth/logout`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
            }
        } catch (e) {
            console.warn('Backend logout failed or was unreachable', e);
        } finally {
            this.clearStoredToken();
        }
    }

    _storeTokens(accessToken, refreshToken, user) {
        if (accessToken) {
            const authState = {
                state: {
                    user: user || null,
                    csrfToken: accessToken
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
            const authStr = localStorage.getItem('rv-auth');
            if (authStr) {
                const parsed = JSON.parse(authStr);
                return parsed?.state?.csrfToken || null;
            }
        } catch (e) {
            return null;
        }
        return null;
    }
    
    getUser() {
        try {
            const authStr = localStorage.getItem('rv-auth');
            if (authStr) {
                const parsed = JSON.parse(authStr);
                return parsed?.state?.user || null;
            }
        } catch (e) {
            return null;
        }
        return null;
    }

    clearStoredToken() {
        localStorage.removeItem('rv-auth');
        localStorage.removeItem('revluma_refresh_token');
        localStorage.removeItem('revluma_token'); // Cleanup legacy mock token
    }

    isAuthenticated() {
        return !!this.getStoredToken();
    }

    // Helper methods preserved for UI compatibility
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

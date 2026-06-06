/**
 * Revluma Authentication Client
 * Production-grade session-based auth with JWT fallback
 *
 * BUG FIX: The `fetchWithAuth` method mutated `error.message` directly on a caught
 * `DOMException` (AbortError). The `.message` property on `DOMException` (and all
 * native Error subclasses) is a read-only getter — assigning to it throws:
 *   "TypeError: Cannot set property message of which has only a getter"
 * This TypeError propagated up and showed as the login failure message.
 *
 * FIX: Instead of mutating the caught error, create a new Error with the desired
 * message and copy over any extra properties. This matches standard practice.
 */

class RevlumaAuth {
    constructor(config = {}) {
        const prodBackendUrl = 'https://revluma.onrender.com/api';
        const hostname = (window.location.hostname || '').toLowerCase();
        const isVercelHost = hostname.endsWith('.vercel.app') || hostname.endsWith('.vercel.sh');
        const isRenderHost = hostname === 'revluma.onrender.com' || hostname.endsWith('.revluma.onrender.com');
        const isCustomDomain = hostname === 'revluma.com' || hostname.endsWith('.revluma.com');
        const isRevlumaHost = hostname.includes('revluma');
        const isProduction = isRenderHost || (isVercelHost && isRevlumaHost) || isCustomDomain;
        const appApiBase = window.APP_API_BASE || (isProduction ? prodBackendUrl : '/api');

        if (!window.APP_API_BASE) {
            window.APP_API_BASE = appApiBase;
        }

        this.baseUrl = config.baseUrl || `${appApiBase}/session`;
        this.fallbackBaseUrl = config.fallbackBaseUrl || `${appApiBase}/auth`;
        this.sessionCookie = 'revluma_session';
        this.timeout = config.timeout || 15000;
        this.extendedTimeout = config.extendedTimeout || 90000;
        this.maxRetries = config.maxRetries !== undefined ? config.maxRetries : 1;
        this.debug = config.debug !== undefined ? config.debug : window.location.hostname === 'revluma.vercel.app';

        // Cache for CSRF token
        this.csrfToken = null;
        this.csrfTokenExpiry = null;

        // Session state
        this.user = null;
        this.isAuthenticated = false;
    }

    /**
     * Fetch with credentials and proper error handling
     *
     * BUG FIX: Replaced `error.message = ...` (throws TypeError on read-only getter)
     * with creating a new Error object when a timeout (AbortError) is detected.
     */
    async fetchWithAuth(url, options = {}) {
        const retryCount = options._retryCount || 0;
        const timeout = retryCount === 0 ? this.timeout : (this.extendedTimeout || 90000);

        const defaultOptions = {
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        };

        const mergedOptions = { ...defaultOptions, ...options };
        delete mergedOptions._retryCount;

        if (this.debug) {
            console.debug('[RevlumaAuth] fetchWithAuth start', {
                url,
                method: mergedOptions.method || 'GET',
                timeout,
                retryCount
            });
        }

        // Fetch CSRF on initial attempt only — cached token used on retry
        if (retryCount === 0 && mergedOptions.method && !['GET', 'HEAD', 'OPTIONS'].includes(mergedOptions.method)) {
            const csrfToken = await this.getCsrfToken();
            if (csrfToken) {
                defaultOptions.headers['X-CSRF-Token'] = csrfToken;
            }
        }

        const controller = new AbortController();
        let didTimeout = false;
        const timeoutId = setTimeout(() => {
            didTimeout = true;
            controller.abort();
        }, timeout);

        try {
            const response = await fetch(url, {
                ...mergedOptions,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const httpError = new Error(`HTTP ${response.status}: ${response.statusText}`);
                httpError.status = response.status;
                try {
                    httpError.data = await response.json();
                } catch {
                    httpError.data = null;
                }
                throw httpError;
            }

            return await response.json();

        } catch (caughtError) {
            clearTimeout(timeoutId);

            if (didTimeout || (caughtError && caughtError.name === 'AbortError')) {
                if (retryCount < this.maxRetries) {
                    if (this.debug) {
                        console.warn('[RevlumaAuth] Request timed out, retrying with extended timeout', {
                            url, timeout, retryCount: retryCount + 1
                        });
                    }
                    return this.fetchWithAuth(url, { ...options, _retryCount: retryCount + 1 });
                }

                const timeoutError = new Error(`Request timed out after ${timeout}ms: ${url}`);
                timeoutError.code = 'REQUEST_TIMEOUT';
                timeoutError.originalError = caughtError;
                if (this.debug) {
                    console.warn('[RevlumaAuth] Request timed out', { url, timeout });
                }
                throw timeoutError;
            }

            if (this.debug) {
                console.error('[RevlumaAuth]', caughtError);
            }
            throw caughtError;
        }
    }

    /**
     * Get or refresh CSRF token
     */
    async getCsrfToken(force = false) {
        if (this.csrfToken && this.csrfTokenExpiry && !force) {
            if (Date.now() < this.csrfTokenExpiry) {
                return this.csrfToken;
            }
        }

        try {
            const response = await this.fetchWithAuth(`${this.baseUrl}/csrf-token`);
            if (response.csrfToken) {
                this.csrfToken = response.csrfToken;
                // Token valid for 25 minutes (server TTL is 30 min / or matches session)
                this.csrfTokenExpiry = Date.now() + 25 * 60 * 1000;
                return this.csrfToken;
            }
        } catch (error) {
            if (this.debug) {
                console.warn('[RevlumaAuth] CSRF token fetch failed:', error);
            }
        }

        return null;
    }

    /**
     * Check auto-login: Session first, JWT fallback
     */
    async checkAutoLogin() {
        try {
            const response = await this.fetchWithAuth(`${this.baseUrl}/me`);

            if (response.authenticated && response.user) {
                this.user = response.user;
                this.isAuthenticated = true;
                return this.user;
            }
        } catch (error) {
            if (this.debug) {
                console.log('[RevlumaAuth] Session check failed, trying JWT fallback...');
            }
        }

        // JWT Fallback
        const token = this.getStoredToken();
        if (token) {
            try {
                const response = await this.fetchWithAuth(`${this.fallbackBaseUrl}/me`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (response.authenticated && response.user) {
                    this.user = response.user;
                    this.isAuthenticated = true;
                    return this.user;
                }
            } catch (error) {
                if (this.debug) {
                    console.log('[RevlumaAuth] JWT fallback also failed');
                }
                this.clearStoredToken();
            }
        }

        this.user = null;
        this.isAuthenticated = false;
        return null;
    }

    /**
     * Sign up with email, password, name
     */
    async signup(email, password, firstName, lastName) {
        try {
            const response = await this.fetchWithAuth(`${this.baseUrl}/signup`, {
                method: 'POST',
                body: JSON.stringify({
                    email: email.toLowerCase().trim(),
                    password,
                    firstName: firstName.trim(),
                    lastName: lastName.trim()
                })
            });

            if (response.user && response.sessionEstablished) {
                this.user = response.user;
                this.isAuthenticated = true;

                if (response.csrfToken) {
                    this.csrfToken = response.csrfToken;
                    this.csrfTokenExpiry = Date.now() + 25 * 60 * 1000;
                }

                return {
                    success: true,
                    user: response.user,
                    message: response.message
                };
            }

            throw new Error(response.error || 'Signup failed');
        } catch (error) {
            return {
                success: false,
                error: error.data?.error || error.message,
                code: error.data?.code
            };
        }
    }

    /**
     * Login with email and password
     */
    async login(email, password) {
        try {
            const response = await this.fetchWithAuth(`${this.baseUrl}/login`, {
                method: 'POST',
                body: JSON.stringify({
                    email: email.toLowerCase().trim(),
                    password
                })
            });

            if (response.user && response.sessionEstablished) {
                this.user = response.user;
                this.isAuthenticated = true;

                if (response.csrfToken) {
                    this.csrfToken = response.csrfToken;
                    this.csrfTokenExpiry = Date.now() + 25 * 60 * 1000;
                }

                return {
                    success: true,
                    user: response.user,
                    message: response.message
                };
            }

            throw new Error(response.error || 'Login failed');
        } catch (error) {
            return {
                success: false,
                error: error.data?.error || error.message,
                code: error.data?.code
            };
        }
    }

    /**
     * Logout: Clear session and tokens — comprehensive cleanup
     */
    async logout() {
        try {
            const csrfToken = this.csrfToken || await this.getCsrfToken();

            if (csrfToken) {
                await this.fetchWithAuth(`${this.baseUrl}/logout`, {
                    method: 'POST',
                    headers: {
                        'X-CSRF-Token': csrfToken
                    }
                });
            }
        } catch (error) {
            if (this.debug) {
                console.warn('[RevlumaAuth] Logout request failed:', error);
            }
        } finally {
            this.user = null;
            this.isAuthenticated = false;
            this.csrfToken = null;
            this.csrfTokenExpiry = null;
            this.clearStoredToken();

            try {
                const authKeys = [
                    'revluma_token',
                    'revluma_user',
                    'revluma_pending_token',
                    'revluma_remembered_email',
                    'csrf_token',
                    'auth_bridge'
                ];
                authKeys.forEach(key => {
                    try {
                        localStorage.removeItem(key);
                        sessionStorage.removeItem(key);
                    } catch (e) { }
                });
            } catch (error) {
                if (this.debug) {
                    console.warn('[RevlumaAuth] Cleanup failed:', error);
                }
            }
        }

        return { success: true };
    }

    /**
     * Refresh session token (sliding window)
     */
    async refreshSession() {
        try {
            const response = await this.fetchWithAuth(`${this.baseUrl}/refresh`, {
                method: 'POST'
            });

            if (response.message) {
                return {
                    success: true,
                    expiresAt: response.expiresAt
                };
            }

            throw new Error(response.error || 'Session refresh failed');
        } catch (error) {
            return {
                success: false,
                error: error.data?.error || error.message,
                code: error.data?.code
            };
        }
    }

    /**
     * Validate session explicitly
     */
    async validateSession() {
        try {
            const response = await this.fetchWithAuth(`${this.baseUrl}/validate`, {
                method: 'GET'
            });

            if (response.authenticated) {
                this.user = response.user;
                this.isAuthenticated = true;
                return response;
            }

            throw new Error(response.error || 'Session validation failed');
        } catch (error) {
            return {
                authenticated: false,
                error: error.data?.error || error.message,
                code: error.data?.code
            };
        }
    }

    /**
     * Request password reset
     */
    async requestPasswordReset(email) {
        try {
            const response = await this.fetchWithAuth(`${this.fallbackBaseUrl}/forgot-password`, {
                method: 'POST',
                body: JSON.stringify({
                    email: email.toLowerCase().trim()
                })
            });

            if (response.message) {
                return {
                    success: true,
                    message: response.message
                };
            }

            throw new Error(response.error || 'Password reset request failed');
        } catch (error) {
            return {
                success: false,
                error: error.data?.error || error.message
            };
        }
    }

    storeToken(token) {
        try {
            localStorage.setItem('revluma_token', token);
        } catch (error) {
            if (this.debug) {
                console.warn('[RevlumaAuth] Failed to store token:', error);
            }
        }
    }

    getStoredToken() {
        try {
            return localStorage.getItem('revluma_token');
        } catch (error) {
            return null;
        }
    }

    clearStoredToken() {
        try {
            localStorage.removeItem('revluma_token');
        } catch (error) {
            if (this.debug) {
                console.warn('[RevlumaAuth] Failed to clear token:', error);
            }
        }
    }

    getErrorMessage(error) {
        if (typeof error === 'string') return error;
        if (error.data && error.data.error) return error.data.error;
        if (error.message) return error.message;
        return 'An unknown error occurred';
    }

    hasRole(role) {
        return this.user && this.user.role === role;
    }

    isAdmin() {
        return this.hasRole('admin') || this.hasRole('owner');
    }

    isEmailVerified() {
        return this.user && this.user.email_verified === true;
    }

    getTenantId() {
        return this.user ? this.user.tenant_id : null;
    }
}

// Global instance
window.revlumaAuth = window.revlumaAuth || new RevlumaAuth({
    timeout: 15000,
    extendedTimeout: 90000,
    maxRetries: 1,
    debug: window.location.hostname === 'revluma.vercel.app'
});
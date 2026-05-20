/**
 * Revluma Authentication Client
 * Production-grade session-based auth with JWT fallback
 * 
 * Usage: 
 *   const auth = new RevlumaAuth();
 *   auth.checkAutoLogin().then(user => { ... })
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
     */
    async fetchWithAuth(url, options = {}) {
        const defaultOptions = {
            credentials: 'include', // Always include cookies
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        };

        // Add CSRF token for non-GET requests
        if (options.method && !['GET', 'HEAD', 'OPTIONS'].includes(options.method)) {
            const csrfToken = await this.getCsrfToken();
            if (csrfToken) {
                defaultOptions.headers['X-CSRF-Token'] = csrfToken;
            }
        }

        const mergedOptions = { ...defaultOptions, ...options };

        if (this.debug) {
            console.debug('[RevlumaAuth] fetchWithAuth start', {
                url,
                method: mergedOptions.method || 'GET',
                headers: mergedOptions.headers,
                timeout: this.timeout
            });
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);

            const response = await fetch(url, {
                ...mergedOptions,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
                error.status = response.status;
                try {
                    error.data = await response.json();
                } catch {
                    error.data = null;
                }
                throw error;
            }

            return await response.json();
        } catch (error) {
            if (error.name === 'AbortError') {
                error.message = `Request timed out after ${this.timeout}ms: ${url}`;
                error.code = 'REQUEST_TIMEOUT';
            }
            if (this.debug) {
                console.error('[RevlumaAuth]', error);
            }
            throw error;
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
                // Token valid for 25 minutes (request from server was 30 min TTL)
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

        // JWT Fallback: Check Authorization header
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

                // Store CSRF token from response
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

                // Store CSRF token from response
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
            // Clear state regardless of logout success
            this.user = null;
            this.isAuthenticated = false;
            this.csrfToken = null;
            this.csrfTokenExpiry = null;
            this.clearStoredToken();

            // Comprehensive cleanup of all auth-related keys
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
                    console.warn('[RevlumaAuth] Comprehensive logout cleanup failed:', error);
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
     * Request password reset (if available)
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

    /**
     * Store JWT token locally (for JWT fallback)
     */
    storeToken(token) {
        try {
            localStorage.setItem('revluma_token', token);
        } catch (error) {
            if (this.debug) {
                console.warn('[RevlumaAuth] Failed to store token:', error);
            }
        }
    }

    /**
     * Get stored JWT token
     */
    getStoredToken() {
        try {
            return localStorage.getItem('revluma_token');
        } catch (error) {
            return null;
        }
    }

    /**
     * Clear stored JWT token
     */
    clearStoredToken() {
        try {
            localStorage.removeItem('revluma_token');
        } catch (error) {
            if (this.debug) {
                console.warn('[RevlumaAuth] Failed to clear token:', error);
            }
        }
    }

    /**
     * Format error message for display
     */
    getErrorMessage(error) {
        if (typeof error === 'string') {
            return error;
        }
        if (error.data && error.data.error) {
            return error.data.error;
        }
        if (error.message) {
            return error.message;
        }
        return 'An unknown error occurred';
    }

    /**
     * Check if user has a specific role
     */
    hasRole(role) {
        return this.user && this.user.role === role;
    }

    /**
     * Check if user is admin
     */
    isAdmin() {
        return this.hasRole('admin') || this.hasRole('owner');
    }

    /**
     * Check if user email is verified
     */
    isEmailVerified() {
        return this.user && this.user.email_verified === true;
    }

    /**
     * Get user's tenant ID
     */
    getTenantId() {
        return this.user ? this.user.tenant_id : null;
    }
}

// Global instance
window.revlumaAuth = window.revlumaAuth || new RevlumaAuth({
    timeout: 15000,
    debug: window.location.hostname === 'revluma.vercel.app'
});

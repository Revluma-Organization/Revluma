class RevlumaAuth {
    constructor() {
        this.user = {
            id: "mock-user-001",
            email: "alex@mystore.com",
            full_name: "Alex Johnson",
            display_name: "Alex",
            role: "admin",
            tenant_id: "tenant-001",
            email_verified: true,
            onboarding_status: "completed",
            membership_tier: "pro",
            account_status: "active"
        };
        this.isAuthenticated = true;
    }

    async checkAutoLogin() {
        return this.user;
    }

    async login(email, password) {
        this.isAuthenticated = true;
        this.user.email = email;
        return { success: true, user: this.user, message: "Mock login successful" };
    }

    async signup(email, password, firstName, lastName) {
        this.isAuthenticated = true;
        this.user.email = email;
        this.user.full_name = `${firstName} ${lastName}`;
        return { success: true, user: this.user, message: "Mock signup successful" };
    }

    async logout() {
        this.isAuthenticated = false;
        this.user = null;
        return { success: true };
    }

    async refreshSession() {
        return { success: true, expiresAt: new Date(Date.now() + 3600000).toISOString() };
    }

    async validateSession() {
        return { authenticated: true, user: this.user };
    }

    async requestPasswordReset(email) {
        return { success: true, message: "Mock password reset email sent" };
    }

    storeToken(token) {
        try { localStorage.setItem('revluma_token', token); } catch (e) {}
    }

    getStoredToken() {
        try { return localStorage.getItem('revluma_token'); } catch (e) { return null; }
    }

    clearStoredToken() {
        try { localStorage.removeItem('revluma_token'); } catch (e) {}
    }

    getErrorMessage(error) {
        if (typeof error === 'string') return error;
        if (error && error.message) return error.message;
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

window.revlumaAuth = window.revlumaAuth || new RevlumaAuth();

/**
 * Revluma API Client
 * Production-ready API integration for dashboard
 * 
 * Usage:
 *   const data = await api.dashboard.get();
 *   const revenue = await api.metrics.revenue();
 *   const insights = await api.insights.get();
 */

const RevlumaAPI = (function() {
  'use strict';

  const API_BASE = '/api/v1';
  
  // Token management
  let authToken = localStorage.getItem('rvToken');
  let refreshToken = localStorage.getItem('rvRefresh');

  // ============================================================
  // HTTP Client
  // ============================================================
  
  async function request(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...options.headers
      },
      ...options
    };

    try {
      const response = await fetch(url, config);
      
      // Handle authentication errors
      if (response.status === 401) {
        // Try to refresh token
        const refreshed = await refreshAccessToken();
        if (refreshed) {
          // Retry with new token
          config.headers.Authorization = `Bearer ${authToken}`;
          return fetch(url, config);
        }
        // Refresh failed - redirect to login
        handleLogout();
        throw new Error('Session expired');
      }

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
      }

      return data;
    } catch (error) {
      console.error(`API Error [${endpoint}]:`, error);
      throw error;
    }
  }

  // ============================================================
  // Token Management
  // ============================================================
  
  async function refreshAccessToken() {
    if (!refreshToken) return false;

    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
      });

      if (!response.ok) return false;

      const data = await response.json();
      authToken = data.token;
      refreshToken = data.refreshToken;
      
      localStorage.setItem('rvToken', authToken);
      localStorage.setItem('rvRefresh', refreshToken);

      return true;
    } catch (error) {
      console.error('Token refresh failed:', error);
      return false;
    }
  }

  function handleLogout() {
    localStorage.removeItem('rvToken');
    localStorage.removeItem('rvRefresh');
    authToken = null;
    refreshToken = null;
    window.location.href = '/auth/loginIn.html';
  }

  // ============================================================
  // Dashboard API
  // ============================================================
  
  const dashboard = {
    /**
     * Get complete dashboard data
     * @param {string} range - 7d, 30d, 90d, today
     * @returns {Promise<Object>}
     */
    async get(range = '30d') {
      const data = await request(`/dashboard?range=${range}`);
      return data.data;
    },

    /**
     * Get quick summary for live updates
     * @returns {Promise<Object>}
     */
    async summary() {
      const data = await request('/dashboard/summary');
      return data.data;
    }
  };

  // ============================================================
  // Metrics API
  // ============================================================
  
  const metrics = {
    /**
     * Get chart data
     * @param {string} range - 7d, 30d, 90d
     * @returns {Promise<Object>}
     */
    async get(range = '30d') {
      const data = await request(`/metrics?range=${range}`);
      return data.data;
    },

    /**
     * Get revenue metrics
     * @param {string} range - 7d, 30d, 90d
     * @returns {Promise<Object>}
     */
    async revenue(range = '30d') {
      const data = await request(`/metrics/revenue?range=${range}`);
      return data.data;
    },

    /**
     * Get customer metrics
     * @returns {Promise<Object>}
     */
    async customers() {
      const data = await request('/metrics/customers');
      return data.data;
    }
  };

  // ============================================================
  // Customers API
  // ============================================================
  
  const customers = {
    /**
     * Get customer list
     * @param {Object} options - page, limit, segment
     * @returns {Promise<Object>}
     */
    async list(options = {}) {
      const params = new URLSearchParams(options).toString();
      const data = await request(`/customers?${params}`);
      return data.data;
    },

    /**
     * Get customer segments
     * @returns {Promise<Object>}
     */
    async segments() {
      const data = await request('/customers/segments');
      return data.data;
    },

    /**
     * Get single customer
     * @param {string} id
     * @returns {Promise<Object>}
     */
    async get(id) {
      const data = await request(`/customers/${id}`);
      return data.data;
    }
  };

  // ============================================================
  // Insights API
  // ============================================================
  
  const insights = {
    /**
     * Get AI insights
     * @returns {Promise<Object>}
     */
    async get() {
      const data = await request('/insights');
      return data.data;
    },

    /**
     * Get recommendations
     * @returns {Promise<Object>}
     */
    async recommendations() {
      const data = await request('/insights/recommendations');
      return data.data;
    }
  };

  // ============================================================
  // WebSocket for Real-time Updates
  // ============================================================
  
  let ws = null;
  let wsReconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 5;

  function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) return;

    const wsUrl = (window.location.protocol === 'https:' ? 'wss:' : 'ws:') 
      + '//' + window.location.host + '/api/v1/ws';

    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('WebSocket connected');
        wsReconnectAttempts = 0;
        
        // Authenticate
        if (authToken) {
          ws.send(JSON.stringify({ type: 'auth', token: authToken }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          handleWebSocketMessage(message);
        } catch (error) {
          console.error('WebSocket message parse error:', error);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        
        // Reconnect with exponential backoff
        if (wsReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(1000 * Math.pow(2, wsReconnectAttempts), 30000);
          setTimeout(connectWebSocket, delay);
          wsReconnectAttempts++;
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    } catch (error) {
      console.error('WebSocket connection failed:', error);
    }
  }

  function handleWebSocketMessage(message) {
    const event = CustomEvent('api:' + message.type, { detail: message.data });
    document.dispatchEvent(event);
  }

  function disconnectWebSocket() {
    if (ws) {
      ws.close();
      ws = null;
    }
  }

  // ============================================================
  // Event Dispatcher
  // ============================================================
  
  function on(eventType, callback) {
    document.addEventListener('api:' + eventType, callback);
    return () => document.removeEventListener('api:' + eventType, callback);
  }

  // ============================================================
  // Public API
  // ============================================================
  
  return {
    // Core
    request,
    
    // Resources
    dashboard,
    metrics,
    customers,
    insights,
    
    // WebSocket
    ws: {
      connect: connectWebSocket,
      disconnect: disconnectWebSocket
    },
    
    // Events
    on,
    
    // Auth helpers
    setTokens(token, refresh) {
      authToken = token;
      refreshToken = refresh;
      localStorage.setItem('rvToken', token);
      localStorage.setItem('rvRefresh', refresh);
    },
    
    clearTokens() {
      authToken = null;
      refreshToken = null;
      localStorage.removeItem('rvToken');
      localStorage.removeItem('rvRefresh');
    },
    
    isAuthenticated() {
      return !!authToken;
    },

    // Utility
    formatCurrency: (value) => {
      return new Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: 1,
        style: 'currency',
        currency: 'USD'
      }).format(value);
    },

    formatPercent: (value) => {
      return new Intl.NumberFormat('en-US', {
        style: 'percent',
        minimumFractionDigits: 1
      }).format(value / 100);
    }
  };

})();

// Export for use in browsers
if (typeof window !== 'undefined') {
  window.RevlumaAPI = RevlumaAPI;
}

// Export for modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RevlumaAPI;
}
/**
 * Loading Skeletons and Error States
 * Production-ready visual states for dashboard
 */

const LoadingStates = (function() {
  'use strict';

  // ============================================================
  // Skeleton Styles (injected into page)
  // ============================================================
  
  const CSS = `
    .skeleton {
      background: linear-gradient(90deg, var(--bg-3) 25%, var(--bg-4) 50%, var(--bg-3) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.5s ease-in-out infinite;
      border-radius: var(--r-sm);
    }

    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    .skeleton-text {
      height: 1em;
      margin-bottom: 0.5em;
      border-radius: 4px;
    }

    .skeleton-text.short { width: 40%; }
    .skeleton-text.medium { width: 70%; }
    .skeleton-text.long { width: 90%; }

    .skeleton-value {
      height: 2.05em;
      width: 60%;
      border-radius: 6px;
    }

    .skeleton-label {
      height: 0.8em;
      width: 50%;
      border-radius: 4px;
    }

    .skeleton-sparkline {
      height: 38px;
      width: 100%;
    }

    .skeleton-chart {
      height: 200px;
      width: 100%;
      border-radius: var(--r);
    }

    .skeleton-avatar {
      width: 30px;
      height: 30px;
      border-radius: 50%;
    }

    .skeleton-row {
      height: 48px;
      width: 100%;
      margin-bottom: 8px;
    }

    /* Error states */
    .error-state {
      text-align: center;
      padding: 60px 20px;
    }

    .error-icon {
      width: 48px;
      height: 48px;
      margin: 0 auto 16px;
    }

    .error-icon svg {
      width: 100%;
      height: 100%;
      stroke: var(--red);
    }

    .error-title {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--t1);
      margin: 0 0 8px;
    }

    .error-message {
      color: var(--t3);
      margin-bottom: 20px;
      max-width: 400px;
      margin-left: auto;
      margin-right: auto;
    }

    .btn-retry {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: var(--accent);
      color: #000;
      border: none;
      border-radius: var(--r-sm);
      padding: 10px 20px;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      transition: all var(--trans);
    }

    .btn-retry:hover {
      background: var(--accent-2);
      transform: translateY(-1px);
    }

    /* Empty states */
    .empty-state {
      text-align: center;
      padding: 40px 20px;
    }

    .empty-icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 16px;
      opacity: 0.5;
    }

    .empty-title {
      font-size: 1rem;
      font-weight: 600;
      color: var(--t1);
      margin: 0 0 8px;
    }

    .empty-message {
      color: var(--t3);
      margin-bottom: 16px;
    }

    /* Loading spinner */
    .spinner {
      width: 24px;
      height: 24px;
      border: 2px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Inline loading */
    .loading-inline {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .loading-inline .spinner {
      width: 16px;
      height: 16px;
    }
  `;

  // Inject styles
  function injectStyles() {
    if (document.getElementById('loading-states-css')) return;
    
    const style = document.createElement('style');
    style.id = 'loading-states-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // ============================================================
  // Skeleton Renderers
  // ============================================================
  
  function renderMetricCardSkeleton() {
    return `
      <div class="metric-card">
        <div class="mc-header">
          <div class="skeleton skeleton-label"></div>
        </div>
        <div class="mc-value skeleton skeleton-value"></div>
        <div class="mc-footer">
          <div class="skeleton skeleton-text short"></div>
        </div>
        <div class="skeleton skeleton-sparkline"></div>
      </div>
    `;
  }

  function renderChartSkeleton() {
    return `
      <div class="chart-card">
        <div class="section-head">
          <div class="skeleton skeleton-text medium"></div>
        </div>
        <div class="skeleton skeleton-chart"></div>
      </div>
    `;
  }

  function renderActivityItemSkeleton() {
    return `
      <div class="activity-item">
        <div class="skeleton" style="width:6px;height:6px;border-radius:50%"></div>
        <div class="skeleton skeleton-text long"></div>
      </div>
    `;
  }

  function renderInsightsSkeleton() {
    return `
      <div class="insight-item">
        <div class="skeleton" style="width:26px;height:26px;border-radius:6px"></div>
        <div class="skeleton skeleton-text long"></div>
      </div>
    `;
  }

  // ============================================================
  // Error Renderers
  // ============================================================
  
  function renderErrorState(message, onRetry) {
    injectStyles();
    
    return `
      <div class="error-state">
        <div class="error-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <h3 class="error-title">Something went wrong</h3>
        <p class="error-message">${message || 'We couldn\'t load this data. Please try again.'}</p>
        <button class="btn-retry" onclick="${onRetry ? onRetry : 'location.reload()'}">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 4v6h6"/>
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
          </svg>
          Try Again
        </button>
      </div>
    `;
  }

  function renderInlineError(message) {
    injectStyles();
    return `
      <div class="loading-inline" style="color:var(--red)">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span>${message}</span>
      </div>
    `;
  }

  // ============================================================
  // Empty State Renderers
  // ============================================================
  
  function renderEmptyState(title, message, actionLabel, onAction) {
    injectStyles();
    
    return `
      <div class="empty-state">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--t3)" stroke-width="1.5">
            <path d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-2.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/>
          </svg>
        </div>
        <h4 class="empty-title">${title}</h4>
        <p class="empty-message">${message}</p>
        ${actionLabel ? `<button class="btn-primary" onclick="${onAction}">${actionLabel}</button>` : ''}
      </div>
    `;
  }

  // ============================================================
  // State Manager
  // ============================================================
  
  class DashboardState {
    constructor(containerSelector) {
      this.container = document.querySelector(containerSelector);
      this.state = 'loading'; // loading, error, empty, ready
      this.data = null;
      this.error = null;
      injectStyles();
    }

    async load(fetchFn) {
      this.setState('loading');
      
      try {
        const data = await fetchFn();
        this.data = data;
        this.setState(data && Object.keys(data).length > 0 ? 'ready' : 'empty');
      } catch (error) {
        this.error = error;
        this.setState('error');
      }
    }

    setState(state) {
      this.state = state;
      this.render();
    }

    render() {
      if (!this.container) return;

      switch (this.state) {
        case 'loading':
          this.container.innerHTML = this.renderLoading();
          break;
        case 'error':
          this.container.innerHTML = this.renderError();
          break;
        case 'empty':
          this.container.innerHTML = this.renderEmpty();
          break;
        case 'ready':
          this.renderReady();
          break;
      }
    }

    renderLoading() {
      return `
        <div class="metrics-grid">
          ${renderMetricCardSkeleton()}
          ${renderMetricCardSkeleton()}
          ${renderMetricCardSkeleton()}
          ${renderMetricCardSkeleton()}
        </div>
      `;
    }

    renderError() {
      return `
        <div class="error-state">
          ${renderErrorState(this.error?.message)}
        </div>
      `;
    }

    renderEmpty() {
      return `
        <div class="empty-state">
          ${renderEmptyState(
            'No data yet',
            'Connect your store to start tracking metrics',
            'Connect Store',
            'toggleState()'
          )}
        </div>
      `;
    }

    renderReady() {
      // Override in subclass
    }
  }

  // ============================================================
  // Initialize
  // ============================================================
  
  function init() {
    injectStyles();
  }

  // Auto-init when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ============================================================
  // Public API
  // ============================================================
  
  return {
    init,
    injectStyles,
    renderMetricCardSkeleton,
    renderChartSkeleton,
    renderActivityItemSkeleton,
    renderInsightsSkeleton,
    renderErrorState,
    renderInlineError,
    renderEmptyState,
    DashboardState
  };

})();

// Export
if (typeof window !== 'undefined') {
  window.LoadingStates = LoadingStates;
}
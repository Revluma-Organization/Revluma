# Revluma Frontend-to-Backend Handover Document
**Module**: Settings Dashboard & Billing Architecture  
**Status**: Production API-Ready (Static Mocks & Dummy Fallbacks Removed)  
**Date**: 26 July 2026  
**Language**: British English (`en-GB`)

---

## 1. Executive Summary

This document serves as the technical specification and handover guide for transitioning the Revluma Settings Dashboard from static UI prototypes into a dynamic, API-driven frontend architecture built with **React 18**, **TypeScript**, **Tailwind CSS**, and **Framer Motion**.

Throughout this sprint, we systematically removed hardcoded mock data, local-only state mutations, and demonstration fallbacks across twelve core dashboard settings modules. All components now operate on a strict **API-first contract**:
1. Initial states start empty or `null`—never populated with dummy arrays.
2. Component mount cycles trigger asynchronous REST fetch requests via a shared `api` wrapper (`/lib/api`).
3. Loading skeletons and high-contrast empty states render whilst awaiting backend payloads or when datasets are zero-length.
4. Modifying actions (creations, updates, revocations, deletions, and ownership transfers) strictly await network responses before updating local UI states or surfacing user feedback.

---

## 2. Component Architecture & File Directory

All settings modules reside within `Frontend/Dashboard/src/pages/settings/` and are organised into three functional routing categories:

### A. Workspace Management
| File Name | Location | 1-Sentence Summary |
| :--- | :--- | :--- |
| `Organization.tsx` | [Organization.tsx](file:///C:/Users/okanl/Desktop/Revluma/Frontend/Dashboard/src/pages/settings/Organization.tsx) | Manages enterprise profile details, industry classification via an interactive combobox, and workspace metadata. |
| `TeamMembers.tsx` | [TeamMembers.tsx](file:///C:/Users/okanl/Desktop/Revluma/Frontend/Dashboard/src/pages/settings/TeamMembers.tsx) | Fetches and renders connected workspace collaborators in an interactive data table with member invitation and role management controls. |
| `RolesPermissions.tsx` | [RolesPermissions.tsx](file:///C:/Users/okanl/Desktop/Revluma/Frontend/Dashboard/src/pages/settings/RolesPermissions.tsx) | Configures granular role-based access control (RBAC) matrices and administrative permission sets across workspace features. |
| `Branding.tsx` | [Branding.tsx](file:///C:/Users/okanl/Desktop/Revluma/Frontend/Dashboard/src/pages/settings/Branding.tsx) | Customises visual brand identity (primary/accent colours, store logo, favicon) with real-time DOM CSS variable injection and API persistence. |

### B. Account & Security
| File Name | Location | 1-Sentence Summary |
| :--- | :--- | :--- |
| `Preferences.tsx` | [Preferences.tsx](file:///C:/Users/okanl/Desktop/Revluma/Frontend/Dashboard/src/pages/settings/Preferences.tsx) | Controls user-level interface preferences including theme synchronisation, language selection, timezone settings, and date format strings. |
| `Notifications.tsx` | [Notifications.tsx](file:///C:/Users/okanl/Desktop/Revluma/Frontend/Dashboard/src/pages/settings/Notifications.tsx) | Configures multi-channel notification preferences for email, SMS, and in-app alerts across security and storefront events. |
| `ActiveSessions.tsx` | [ActiveSessions.tsx](file:///C:/Users/okanl/Desktop/Revluma/Frontend/Dashboard/src/pages/settings/ActiveSessions.tsx) | Audits active device logins across web browsers and operating systems, enabling individual session revocation or mass sign-out. |
| `DangerZone.tsx` | [DangerZone.tsx](file:///C:/Users/okanl/Desktop/Revluma/Frontend/Dashboard/src/pages/settings/DangerZone.tsx) | Governs irreversible workspace actions including ownership transfer invitations and permanent workspace deletion via confirmation modals. |

### C. Billing & Subscription (Paystack Integration Prep)
| File Name | Location | 1-Sentence Summary |
| :--- | :--- | :--- |
| `BillingOverview.tsx` | [BillingOverview.tsx](file:///C:/Users/okanl/Desktop/Revluma/Frontend/Dashboard/src/pages/settings/BillingOverview.tsx) | Provides a high-level executive dashboard summarising active plans, visitor tracking usage bars, and quick billing links. |
| `Subscription.tsx` | [Subscription.tsx](file:///C:/Users/okanl/Desktop/Revluma/Frontend/Dashboard/src/pages/settings/Subscription.tsx) | Displays live subscription tiers, quota utilisation metrics, and handles upgrade workflows for Growth and Scale tiers. |
| `PaymentMethods.tsx` | [PaymentMethods.tsx](file:///C:/Users/okanl/Desktop/Revluma/Frontend/Dashboard/src/pages/settings/PaymentMethods.tsx) | Manages saved Paystack credit/debit card tokens, default payment method assignment, and card removal requests. |
| `InvoiceHistory.tsx` | [InvoiceHistory.tsx](file:///C:/Users/okanl/Desktop/Revluma/Frontend/Dashboard/src/pages/settings/InvoiceHistory.tsx) | Lists historical Paystack billing cycles and provides downloadable tax-ready PDF receipts and CSV data exports. |

---

## 3. API-Ready State Wiring (The Code)

To ensure seamless integration with the backend API without refactoring components later, every module follows four standardised patterns:

### A. Strict Initial State (No Dummy Data)
Collections start as empty arrays (`[]`) and singular resources start as `null`.

```tsx
// ActiveSessions.tsx — Initialising empty array
const [sessions, setSessions] = useState<DeviceSession[]>([]);
const [isLoading, setIsLoading] = useState<boolean>(true);

// Subscription.tsx — Initialising nullable subscription state
const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
const [isLoadingSub, setIsLoadingSub] = useState<boolean>(true);
```

### B. Asynchronous Mount Fetching via `useEffect`
We wrap HTTP GET calls in `useCallback` and execute them inside `useEffect` on component mount, setting explicit loading states.

```tsx
const fetchSessions = useCallback(async () => {
  setIsLoading(true);
  try {
    const res = await api.get<DeviceSession[]>("/auth/sessions", undefined, {
      skipAuthRedirect: true,
    });
    if (res && Array.isArray(res.data)) {
      setSessions(res.data);
    } else {
      setSessions([]);
    }
  } catch (err) {
    console.warn("Failed to fetch sessions from API:", err);
    setSessions([]);
  } finally {
    setIsLoading(false);
  }
}, []);

useEffect(() => {
  fetchSessions();
}, [fetchSessions]);
```

### C. Loading Spinners & Defensive Empty States
UI containers inspect loading booleans and data lengths to render either animated spinners or dashed empty-state boxes.

```tsx
{isLoading ? (
  <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-100/40 py-16 dark:border-slate-800 dark:bg-slate-900/40">
    <Loader2 className="h-8 w-8 animate-spin text-sky-400" />
    <p className="mt-3 text-sm font-medium text-slate-500 dark:text-slate-400">
      Fetching active device sessions...
    </p>
  </div>
) : sessions.length === 0 ? (
  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-100/50 p-8 text-center dark:border-slate-800 dark:bg-slate-900/30">
    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
      No other active device sessions found.
    </p>
    <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">
      You are only logged in on this current device.
    </p>
  </div>
) : (
  /* Render populated data cards */
)}
```

### D. Asynchronous Action Wiring (`api.post`, `api.put`, `api.delete`)
Modifying handlers await network requests and handle success/failure explicitly without fake `setTimeout` simulations.

```tsx
// DangerZone.tsx — Workspace Deletion Handler
const handleConfirmDelete = async () => {
  if (deleteConfirmText !== "DELETE") return;
  setIsDeleting(true);
  try {
    await api.delete("/workspace", { skipAuthRedirect: true });
    setIsDeleting(false);
    setIsDeletedSuccess(true);
    setTimeout(() => {
      setIsDeleteModalOpen(false);
      setDeleteConfirmText("");
      setIsDeletedSuccess(false);
    }, 2000);
  } catch (err) {
    console.error("Failed to delete workspace:", err);
    setIsDeleting(false);
  }
};
```

---

## 4. Required Backend Endpoints (For the Backend Team)

The following REST API endpoints are required to power the refactored frontend settings dashboard. All JSON request/response payloads should use camelCase attributes.

| HTTP Verb | Endpoint Path | Description & Usage | Expected Request Payload | Expected Response Status & Schema |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/auth/sessions` | Fetches active device login sessions for the current user. | *None* | `200 OK` — `DeviceSession[]` |
| `DELETE` | `/api/v1/auth/sessions/:id` | Revokes a specific device session by ID. | *None* | `200 OK` or `204 No Content` |
| `DELETE` | `/api/v1/auth/sessions/others` | Logs the user out of all other device sessions except the current session. | *None* | `200 OK` — `{ revokedCount: number }` |
| `GET` | `/api/v1/user/preferences` | Retrieves interface preferences (theme, language, timezone, date format). | *None* | `200 OK` — `{ theme, language, timezone, date_format }` |
| `PUT` | `/api/v1/user/preferences` | Updates interface preferences. | `{ theme, language, timezone, date_format }` | `200 OK` — Updated preferences object |
| `GET` | `/api/v1/settings/branding` | Fetches custom colour palette (`primaryColor`, `accentColor`) and logo URLs. | *None* | `200 OK` — `{ primaryColor, accentColor, logoUrl, faviconUrl }` |
| `PUT` | `/api/v1/settings/branding` | Persists primary and accent hex colour codes. | `{ primaryColor, accentColor }` | `200 OK` — Updated branding object |
| `POST` | `/api/v1/workspace/transfer` | Initiates an ownership transfer invitation email. | `{ email: string }` | `200 OK` — `{ message: string }` |
| `DELETE` | `/api/v1/workspace` | Permanently deletes the active workspace and all associated resources. | *None* | `200 OK` or `204 No Content` |
| `GET` | `/api/v1/billing/subscription` | Retrieves live subscription tier, trial status, visitor usage, and renewal date. | *None* | `200 OK` — `SubscriptionInfo` object |
| `POST` | `/api/v1/billing/subscription/upgrade` | Requests a subscription tier upgrade (`growth` or `scale`). | `{ planId: "growth" \| "scale" }` | `200 OK` — Updated `SubscriptionInfo` |
| `GET` | `/api/v1/billing/payment-methods` | Returns saved Paystack credit/debit card tokens. | *None* | `200 OK` — `SavedCard[]` |
| `POST` | `/api/v1/billing/payment-methods` | Attaches a new tokenised card to the customer profile. | `{ cardNumber, cardHolder, expMonth, expYear }` | `201 Created` — `SavedCard` |
| `DELETE` | `/api/v1/billing/payment-methods/:id` | Removes a saved payment card by token/card ID. | *None* | `200 OK` or `204 No Content` |
| `GET` | `/api/v1/billing/invoices` | Retrieves billing transaction history for past Paystack cycles. | *None* | `200 OK` — `InvoiceRecord[]` |
| `GET` | `/api/v1/billing/invoices/:id/download` | Generates a secure, temporary download URL for an invoice receipt PDF. | *None* | `200 OK` — `{ downloadUrl: string }` |

---

## 5. UI/UX Highlights & Styling Improvements

During this sprint, we implemented rigorous visual enhancements and styling corrections across the settings modules:

### A. Responsive Light & Dark Mode Support (`ActiveSessions.tsx`)
* **Problem**: Text colours were hardcoded for dark backgrounds (`text-white`, `text-slate-300`), making labels invisible when viewing the dashboard in Light Mode.
* **Resolution**: Replaced all hardcoded text classes with responsive Tailwind utilities using the `dark:` prefix:
  * Headers: `text-slate-900 dark:text-white`
  * Subtitles & metadata: `text-slate-600 dark:text-slate-400`
  * Card containers: `bg-white dark:bg-slate-900/80` with `border-slate-200 dark:border-slate-800`
  * Empty states: High-contrast `bg-slate-100/50 dark:bg-slate-900/30` containers with legible text in both viewports.

### B. High-Contrast Destructive Hierarchy (`DangerZone.tsx`)
* **Problem**: Destructive actions previously used generic dark blue buttons that failed to convey warning severity.
* **Resolution**: Enforced strict red visual hierarchies for irreversible operations:
  * Action buttons ("Transfer Workspace", "Delete Workspace"): Styled with `bg-red-600 hover:bg-red-700 text-white border border-red-600 shadow-lg shadow-red-600/30`.
  * Confirmation modal: Uses red ring badges, border glows (`border-red-500/60`), and bold monospace input prompts requiring the user to type `DELETE`.

### C. Live DOM CSS Variable Injection (`Branding.tsx`)
* **Problem**: Colour pickers required page refreshes or manual saves before changes became visible.
* **Resolution**: Integrated native HTML `<input type="color">` pickers that instantly inject CSS custom properties into the browser root upon change:
  ```tsx
  const handlePrimaryColorChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newColor = e.target.value;
    setPrimaryColor(newColor);
    setSaveStatus("idle");
    if (typeof document !== "undefined") {
      document.documentElement.style.setProperty("--primary", newColor);
      document.documentElement.style.setProperty("--primary-color", newColor);
    }
  };
  ```
  This ensures the entire dashboard interface immediately reflects chosen primary and accent brand colours in real time.

---

## 6. Next Steps & Backend Integration Verification

1. **Verify Endpoints in Staging**: As backend engineers deploy the REST endpoints listed in Section 4, verify payload schemas match the TypeScript interfaces defined in each frontend module.
2. **CORS & Auth Headers**: Confirm that `api.get`, `api.post`, `api.put`, and `api.delete` requests transmit valid JWT authentication headers and that backend services allow CORS requests from the Vercel dashboard origin (`revluma.vercel.app`).
3. **End-to-End Testing**: Validate Paystack invoice download URLs and workspace ownership transfer invitation emails in a staging environment.

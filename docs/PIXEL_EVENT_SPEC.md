# Pixel Event Specification Contract

**Objective:** This document serves as the strict, single source of truth and authoritative contract between the Backend ingestion endpoint (2.BE1.6), the future JavaScript tracking pixel, and the ML feature engineering pipeline (`pipeline.py`). 

> **Warning**
> Any mismatch between this spec and `pipeline.py` is considered a critical system defect. Feature names must match exactly.

---

## 1. Event Envelope (Canonical Format)

### 1.1 Root Event Structure
All events MUST follow this exact envelope. No silent field transformations are allowed across the system boundary.

```typescript
{
  event_id: string;              // UUID v4 (unique per event)
  event_type: string;            // REQUIRED (see section 2)
  timestamp: string;             // ISO 8601 UTC
  session_id: string;            // REQUIRED for behavioural grouping
  user_id?: string | null;       // optional
  store_id: string;              // REQUIRED

  platform: "shopify" | "woocommerce" | "custom";

  page: {
    url: string;
    referrer?: string | null;
  };

  device: {
    type: "desktop" | "mobile" | "tablet";
    user_agent: string;
  };

  context?: Record<string, any>; // extensible payload (strictly controlled)
}
```

### 1.2 Validation Rules (Backend)
- Reject events missing `event_type`.
- Reject events missing `session_id`.
- Reject events with invalid timestamps.
- Reject unknown event types unless explicitly whitelisted.

---

## 2. Event Types & Payload Schemas

### 2.1 `PAGE_VIEW`
```json
"context": {
  "path": "string",
  "title": "string" // optional
}
```

### 2.2 `PRODUCT_VIEW`
```json
"context": {
  "product_id": "string",
  "product_name": "string",
  "price": 0.00,
  "currency": "string",
  "category": "string" // optional
}
```

### 2.3 `ADD_TO_CART`
```json
"context": {
  "product_id": "string",
  "quantity": 1,
  "price": 0.00
}
```

### 2.4 `REMOVE_FROM_CART`
```json
"context": {
  "product_id": "string",
  "quantity": 1
}
```

### 2.5 `CHECKOUT_STARTED`
```json
"context": {
  "cart_value": 0.00,
  "currency": "string"
}
```

### 2.6 `CHECKOUT_STEP`
```json
"context": {
  "step_name": "string" // raw platform step
}
```

### 2.7 `PURCHASE_COMPLETED`
```json
"context": {
  "order_id": "string",
  "total_value": 0.00,
  "currency": "string"
}
```

### 2.8 `CUSTOMER_CREATED`
```json
"context": {
  "email": "string"
}
```

### 2.9 `TEXT_COPIED`
```json
"context": {
  "copied_text": "string",
  "element_selector": "string" // e.g. "h1.product-title"
}
```

### 2.10 `COUPON_REJECTED`
```json
"context": {
  "coupon_code": "string",
  "reason": "string" // e.g. "expired", "invalid"
}
```

---

## 3. Shopper Feature Vector (ML Contract)

### 3.1 Vector Size & Constraint
- **Fixed Size:** 29 features.
- **Critical Constraint:** Feature names MUST exactly match `pipeline.py`. No aliases, renaming, or deviations are allowed.

### 3.2 Feature Definitions (29 Features)

**Behavioural Features:**
1. `scroll_depth_checkout_pct`
2. `tab_switch_count_session`
3. `time_on_checkout_step_sec`
4. `cursor_hesitation_ms_on_price_field`
5. `checkout_step_abandoned`

**Transactional Features:**
6. `past_orders_total`
7. `past_orders_with_coupon_pct`
8. `days_since_last_purchase`
9. `avg_order_value`
10. `purchase_frequency_trend`
11. `visited_coupon_page`
12. `searched_discount_terms`

**Temporal / Contextual Features:**
13. `abandoned_at_shipping_reveal`
14. `failed_payment_attempt`
15. `local_hour_of_session`
16. `day_of_week_session`

**Extended M2 Sensitivity Signals:**
17. `google_shopping_referrer`
18. `time_first_view_to_cart_add_hrs`
19. `sale_period_purchase_only`
20. `failed_coupon_attempt`
21. `merchant_avg_order_value`
22. `account_creation_abandonment`
23. `repeat_checkout_attempts`
24. `device_type_mobile`
25. `shipping_eta_dwell_sec`
26. `trust_page_visited`

**New Smart Features:**
27. `failed_coupon_count`
28. `copied_product_title`
29. `cart_value_vs_avg_order_value_ratio`

---

## 4. Checkout Step Normalisation

### 4.1 Purpose & Rules
Normalise platform-specific checkout flows into a unified 0-5 scale. Any unknown step MUST safely fallback to `-1` without breaking the pipeline.

### 4.2 Normalised Scale
| Step Index | Meaning |
| :--- | :--- |
| 0 | Landing / Entry |
| 1 | Cart View |
| 2 | Shipping Info |
| 3 | Payment Info |
| 4 | Review Order |
| 5 | Purchase Complete |

### 4.3 Shopify Mapping
| Shopify Event | Normalised Step |
| :--- | :--- |
| `product page` | 0 |
| `cart` | 1 |
| `shipping` | 2 |
| `payment` | 3 |
| `review` | 4 |
| `thank_you` | 5 |

### 4.4 WooCommerce Mapping
| WooCommerce Hook | Normalised Step |
| :--- | :--- |
| `product_view` | 0 |
| `cart` | 1 |
| `checkout_shipping` | 2 |
| `checkout_payment` | 3 |
| `order_review` | 4 |
| `order_received` | 5 |

---

## 5. System Boundaries

- **Pixel (Future JS SDK):** Only emits events. No transformation logic beyond the envelope.
- **Backend (2.BE1.6):** Validates and stores events. Normalises checkout steps. Forwards clean events to the ML pipeline.
- **ML Pipeline (`pipeline.py`):** Consumes normalised events only. Computes the 29-feature vector strictly as defined.

## 6. Approval
- **Author:** Okanlawon David
- **Shared With:** Afolabi (Backend), Samuel (ML Pipeline)

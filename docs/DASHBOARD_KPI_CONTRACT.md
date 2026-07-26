# Dashboard KPI Endpoint – Technical Contract

**Version:** 1.0  
**Created on:** 2026-07-23  
**Authors:** OMAH THANKGOD (Python-Backend)
**Audience:** AFOLABI (Node.js-Backend) & Frontend Team  
**Purpose:** Define the exact behavior of `GET /api/v1/dashboard/kpis` so the backend response exactly matches what the frontend expects.

---

## 1. Endpoint Information

| Field | Value |
| --- | --- |
| **HTTP Method** | `GET` |
| **Endpoint URL** | `/api/v1/dashboard/kpis` |
| **Authentication** | Bearer Token (JWT) via `authenticateToken` middleware. JWT must be valid and contain `user_id` |
| **Content-Type** | `application/json` |

---

## 2. Query Parameters

| Parameter | Type | Required | Default | Allowed Values | Description |
| --- | --- | --- | --- | --- | --- |
| `period` | string | ❌ No | `7d` | `7d`, `30d`, `90d` | Determines the date range used when calculating dashboard metrics |

**Example Request:**
GET /api/v1/dashboard/kpis?period=30d


**Notes:**
- If no `period` is provided, default to `7d`.
- If an invalid `period` is provided, default to `7d` (do not return an error).

---

## 3. Response Contract

### Success Response Structure

```json
{
  "success": true,
  "data": {
    "kpi": [
      {
        "id": "rev",
        "value": "$12,847.50",
        "delta": "+18.3%",
        "dir": "up",
        "bench": "$10,200.00",
        "spark": [1200, 1350, 1100, 1400, 1300, 1500, 1250, 1600, 1450, 1550, 1700, 1650]
      },
      {
        "id": "carts",
        "value": "47",
        "delta": "-12.5%",
        "dir": "down",
        "bench": "54",
        "spark": [8, 6, 5, 7, 4, 6, 3, 5, 4, 6, 3, 4]
      },
      {
        "id": "rate",
        "value": "24.8%",
        "delta": "+5.2%",
        "dir": "up",
        "bench": "19.6%",
        "spark": [18, 20, 22, 19, 21, 23, 20, 24, 22, 25, 23, 26]
      },
      {
        "id": "subs",
        "value": "1,284",
        "delta": "+8.7%",
        "dir": "up",
        "bench": "1,182",
        "spark": [95, 102, 98, 110, 105, 115, 108, 120, 112, 118, 125, 122]
      },
      {
        "id": "risk",
        "value": "$8,432.00",
        "delta": "+15.3%",
        "dir": "up",
        "bench": "$7,314.00",
        "spark": [650, 700, 680, 720, 690, 750, 710, 780, 740, 760, 800, 790]
      },
      {
        "id": "score",
        "value": "72",
        "delta": "0",
        "dir": "neutral",
        "bench": "—",
        "spark": [65, 68, 70, 69, 71, 72, 70, 73, 72, 74, 73, 72]
      }
    ]
  }
}

"## 4. KPI Ordering (MANDATORY)"
All KPIs must be limited to the authenticated user's stores. Store IDs should be obtained by traversing:
User → Organizations → Stores using Prisma relationships.

i. Revenue (rev)
Total recovered revenue during the selected period.

Calculation:
1. Sum `orders.total` where:

- orders.recovery_status = 'recovered' (or equivalent status indicating recovery)
- orders.ordered_at falls within the selected period
- orders.store_id belongs to the user's organization


Formatting:
- Display as currency: "$12,847.50"(displayed value should be formatted as currency)
- Use en-US locale formatting

Delta Calculation:
- Compare current period revenue with previous equivalent period.
- Example: if period = 30d, compare current 30 days with the previous 30 days.

Sparkline:
- 12 daily values for the selected period.

- For 7d, show hourly or daily (adjust as needed – frontend expects 12 values).

- Recommendation: Use generate_series in PostgreSQL to ensure 12 days of data, filling missing days with 0.



2.  Abandoned Carts (carts)
Total abandoned carts during the selected period.

Calculation:
Count abandoned_carts where:
status = 'abandoned'
- abandoned_at falls within the selected period
- store_id belongs to the user's organization

Formatting:
- Display as integer: "47"

Delta Calculation:
- Compare current period abandoned carts with previous equivalent period.

Sparkline:
- 12 daily values for the selected period.

3 Recovery Rate (rate)
Percentage of abandoned carts that were recovered during the selected period.

Calculation:

Recovery Rate = (Recovered Carts ÷ Total Abandoned Carts) × 100
Where:
- Recovered Carts: Count of abandoned carts with status = 'recovered' during the period.
- Total Abandoned Carts: Count of all abandoned carts during the period.

Edge Cases:
- If Total Abandoned Carts = 0, return "0%".
- Avoid division-by-zero errors.

Formatting:
- Display as percentage with one decimal: "24.8%"

Delta Calculation:
- Compare current period recovery rate with previous equivalent period.

Sparkline:
- 12 daily rate values for the selected period.

4 Subscribers (subs)
Number of customers who opted into email or SMS marketing.

Calculation:

Count customers where:
consent_email = true OR consent_sms = true
- created_at falls within the selected period
- store_id belongs to the user's organization

Formatting:
- Display as integer with comma separators: "1,284"

Delta Calculation:
- Compare current period subscribers with previous equivalent period.

Sparkline:
- 12 daily values for the selected period.

5 Revenue at Risk (risk)
Total value of all currently abandoned carts.

Special Note: Unlike other KPIs, this metric is not filtered by the selected reporting period. It always represents the current total value of open abandoned carts.

Calculation:
Sum abandoned_carts.cart_value where:

- status = 'abandoned'
- store_id belongs to the user's organization
- No date filter – include all current abandoned carts

Formatting:
- Display as currency: "$8,432.00"

Delta Calculation:
- Compare current total risk with the risk from the previous period (using the same logic).

Sparkline:
- 12 daily values for the selected period (showing how the risk evolved over the period).

6 Store Health Score (score)
A holistic score representing the health of the user's stores.

Current Implementation (Phase 1):

This KPI uses hardcoded placeholder values until the Phase 2 machine learning model is available.

Value: "72" (fixed)
Delta: "0" (fixed)
Dir: "neutral" (fixed)
Bench: "—" (fixed dash)
Sparkline: Random-ish values between 65–75 (or use a consistent pattern)


Future Implementation (Phase 2):
The machine learning model will calculate this value based on various store health factors.

Formatting:
- Display as integer: "72"



"## 5. Sparkline Requirements"
Each KPI that supports sparklines must include a spark array with exactly 12 values.

Rules:
- Exactly 12 values – one value per day.
- Always return 12 entries – even when no data exists (use 0 for empty days).
- Order: Most recent day first (descending chronological order).

Recommended Implementation:
Use PostgreSQL generate_series through prisma.$queryRaw to ensure empty dates are included automatically.

Example SQL (PostgreSQL):

sql```
SELECT
  COALESCE(SUM(orders.total), 0) as value,
  date_series.day
FROM generate_series(
  NOW() - INTERVAL '11 days',
  NOW(),
  INTERVAL '1 day'
) AS date_series(day)
LEFT JOIN orders ON DATE(orders.ordered_at) = DATE(date_series.day)
WHERE orders.store_id IN (SELECT id FROM stores WHERE organization_id = $1)
GROUP BY date_series.day
ORDER BY date_series.day DESC;


Frontend Expectation:
- The sparkline chart will render all 12 values.
- Missing data points should show 0 (not null or undefined).

"## 6. Error Responses"
401 Unauthorized
Returned when authenticateToken fails.

json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required. Please provide a valid Bearer token."
  }
}
500 Internal Server Error
Returned for database failures or unexpected exceptions.

json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Failed to retrieve dashboard KPIs. Please try again."
  }
}

"## 7. Database Notes"
Prisma Relationships
The following relations should be used to filter data:

prisma
user {
  organizations {
    stores {
      orders
      abandoned_carts
      customers
    }
  }
}
Store Filtering
javascript
const user = await prisma.user.findUnique({
  where: { id: userId },
  include: {
    organizations: {
      include: {
        stores: {
          select: { id: true }
        }
      }
    }
  }
});

const storeIds = user.organizations.flatMap(org => org.stores.map(store => store.id));
Date Range Calculation
Period	                Date Range
7d	                    Last 7 days (including today)
---------------------------------------------------------------
30d	                    Last 30 days (including today)
-----------------------------------------------------------------
90d	                    Last 90 days (including today)


For delta calculations:

- Current period: [today - period, today]
- Previous period: [today - (period * 2), today - period]

Sparkline Generation (12 values)
For 7d period, you may need to use daily or hourly values to reach 12 points. Consult with frontend team on this.

Recommended approach: Use 12 evenly spaced data points over the selected period:

7d → 12 intervals over 7 days

30d → 12 intervals over 30 days

90d → 12 intervals over 90 days

9. Sample Response (Full)
json
{
  "success": true,
  "data": {
    "kpi": [
      {
        "id": "rev",
        "value": "$12,847.50",
        "delta": "+18.3%",
        "dir": "up",
        "bench": "$10,200.00",
        "spark": [1200, 1350, 1100, 1400, 1300, 1500, 1250, 1600, 1450, 1550, 1700, 1650]
      },
      {
        "id": "carts",
        "value": "47",
        "delta": "-12.5%",
        "dir": "down",
        "bench": "54",
        "spark": [8, 6, 5, 7, 4, 6, 3, 5, 4, 6, 3, 4]
      },
      {
        "id": "rate",
        "value": "24.8%",
        "delta": "+5.2%",
        "dir": "up",
        "bench": "19.6%",
        "spark": [18, 20, 22, 19, 21, 23, 20, 24, 22, 25, 23, 26]
      },
      {
        "id": "subs",
        "value": "1,284",
        "delta": "+8.7%",
        "dir": "up",
        "bench": "1,182",
        "spark": [95, 102, 98, 110, 105, 115, 108, 120, 112, 118, 125, 122]
      },
      {
        "id": "risk",
        "value": "$8,432.00",
        "delta": "+15.3%",
        "dir": "up",
        "bench": "$7,314.00",
        "spark": [650, 700, 680, 720, 690, 750, 710, 780, 740, 760, 800, 790]
      },
      {
        "id": "score",
        "value": "72",
        "delta": "0",
        "dir": "neutral",
        "bench": "—",
        "spark": [65, 68, 70, 69, 71, 72, 70, 73, 72, 74, 73, 72]
      }
    ]
  }
}

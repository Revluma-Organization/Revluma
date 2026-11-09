# Task 226 diagnosis — workspace consistency, language and accessibility

## Baseline and dependencies

Branch `arena/7a0ae458-revluma` began at main `5473a489d12a9c6042f5bbec8d43f50815675389`. Vercel production `dpl_DbdSmKTasYLhC7MNuRkRtL6xDFkR` was READY/PROMOTED from that exact SHA. Public Integrations redirected to authenticated sign-in; no merchant session was available. Backend deployment identity was not exposed.

Original Tasks 317–321 require design consistency, plain language, responsive navigation, focus accessibility and contrast. Tasks 219/220 established Command Center hierarchy and accessible mobile drawer behavior; Tasks 222/223 established Rev conversation controls, loading and evidence; Task 225 established safe cross-workspace context. Task 224 has no implementation record and is not treated as complete.

## Findings

1. Integrations rendered backend/provider messages and resource error codes directly, while Rev and Command Center used separate interpretations.
2. Integrations' custom Shopify modal lacked dialog semantics, focus trapping and reliable focus restoration; its input lacked a programmatic label.
3. Command Center rendered a nested `main` inside the shared shell.
4. Visual values were split between global HSL tokens, legacy `DesignConstants`, Command Center tokens and Rev inline styles. A broad visual rewrite would risk established evidence workflows, so shared light-workspace primitives were introduced and adopted at concrete drift points rather than forcing identical pages.
5. Existing mobile sidebar already implemented focus trapping, Escape and focus restoration. It was retained rather than duplicated.
6. Shared text, brand, status and focus colors have AA-computable treatments. Border `#8490A3` replaces the low-contrast shared control border; purely decorative legacy dividers are not represented as the sole state indicator.

## Scope decision

Implement authoritative tokens, closed merchant-language mapping, shared asynchronous status, accessible Shopify dialog, resource language and landmark correction. Preserve distinct Integrations connection/readiness detail, Command Center operational hierarchy and Rev intelligence-first conversation/evidence workflows. No backend, fixture production data, tenant behavior, OAuth or read-only contract changed.

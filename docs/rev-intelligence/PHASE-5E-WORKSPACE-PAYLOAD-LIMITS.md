# Phase 5E — Rev Workspace: Payload Limits

The evidence-first workspace (`RevIntell.tsx` + `RevInvestigationView.tsx`)
renders **only** the existing `RevAnswerPayload` contract. No pipeline change,
no response-contract change. This note records exactly which fields feed which
surface, which classifications are derived, and what is deliberately never
rendered — so a future change can be checked against the no-fabrication rule.

## Field → surface map

| Workspace surface | Contract source | Notes |
|---|---|---|
| Header back-nav | `return_to` URL hint via `safeWorkspaceRoute` | Sanitised to Command Center routes only; no finding state trusted from the URL |
| Header title | Conversation list `title` for the active id | Never generated; blank rows read "Untitled conversation", matching the list |
| Header context badge | `?finding=` param or restored `selected_finding` | "Finding context" vs "General" — derived from real attachment state only |
| Header Investigating… | Client `thinking` / streaming turn state | Real in-flight state, not a payload status |
| Finding severity chip | `finding.severity` (server `/rev/findings/:id`) or `selected_finding.observation.severity` | Coloured only for `critical/high/medium/low`; any other value renders as neutral raw text |
| Finding category chip | `finding.type` or `selected_finding.type` | Humanised with the existing `formatSourceLabel` (underscores → spaces); absent type renders nothing |
| Finding period | `priority_finding.reporting_period` start/end/timezone | Raw bounds, verbatim; never reformatted or converted |
| Executive summary | `text`, then `response.sections[]` (backend order), then `response.confidence.communication` | Conclusion first; each section renders only if non-empty and not already carried by the text (`coveredBy` dedupe) |
| Evidence ledger | `evidence.items[]` + `evidence.comparison_items[]` | One row per record; comparison-period records carry a Comparison tag **in addition to** their verification badge |
| Findings | `facts[]` with `evidence_ids[]` | Claim-adjacent citation chips; ids that resolve to no retrieved record never become chips |
| Calculated changes | `comparison_facts[]` | Backend-derived change between two retrieved records; badged Calculated |
| Hypotheses | `hypotheses[].statement` | Always labelled "not verified"; never upgraded by `confidence` |
| Unknowns | `unknowns[]` | Rendered verbatim as unknowns |
| Next steps | `recommendations[]` (label/why/measure) + `investigation.follow_ups[]` | Review text only; follow-ups send a new question. Nothing executes a store change |
| How I checked | `investigation.steps[]`, `investigation.period`, `response.confidence.coverage` | Collapsed by default; per-source detail lives in the ledger, not duplicated here |
| Sources row | cited evidence ids | Chip → hover preview → full drawer, unchanged from 5D |
| Evidence drawer | Full turn payload | Unchanged 5D surface, toggled per turn |

## Classification rules (all derived, none invented)

- **Verified** (record): `validation.valid === true` with zero errors AND
  well-formed record (id/metric/label/source/definition/period, valid
  timestamps) AND `status === "available"` AND a usable value. Anything less
  keeps its honest weaker label (`Available — unverified`, `Partial`,
  `Unavailable`, `Not supported`, `Unverified`). Same function as the drawer
  (`validationSucceeded` + `evidenceItemWellFormed` + `formatEvidenceValue`).
- **Calculated**: `comparison_facts[]` entries only. The delta is backend-
  derived from two retrieved records; the records themselves keep their own
  verification badges.
- **Hypothesis / Unknown**: `hypotheses[]` / `unknowns[]` membership only.
- **Missing ≠ zero**: `formatEvidenceValue` renders null/unusable values as
  "Unavailable…"; missing timestamps render "Not supplied or invalid". No
  path renders `0` for a missing value.

## Deliberately never rendered

- Numeric confidence (`{ score, basis }` legacy shape) — hidden, never badged.
- Confidence percentages — a `communication` sentence containing one is
  dropped by `answerConfidence`.
- Coverage as certainty — coverage renders only inside "How I checked".
- Finding evidence from the URL or the question draft — the header shows
  server-resolved metadata; raw evidence markers are never rendered.
- `selected_finding.metrics/coverage/freshness` — carried for context, not
  presented as verified evidence in the workspace.
- Store-change or campaign actions — `recommendations[].executed` is always
  `false`; the workspace renders no executing control.
- Charts of any kind — values render as labelled figures with provenance.

## Quiet turns

`understanding.gate ∈ {conversational, clarify, refuse}` or
`response_mode ∈ {conversational, quick_verification}` renders plain body
text plus (for monetary turns) the provenance line and sources — no summary
heading, no ledger, no report scaffolding. Decided by the backend's own
mode/gate, never inferred from incidental fields.

## Responsive / accessibility contract

- All widths: conversation history is a modal drawer opened from the
  top-right menu button (updated 2026-11-27; the earlier persistent dark rail
  at 1024px and wider was removed at the merchant's request). One history
  surface, one control, and the workspace keeps its full width.
- Ledger rows and disclosures are native-labelled expand/collapse
  (`aria-expanded`); sections are labelled regions; citations expose
  "Citation N … — open evidence"; header controls are native links/buttons.
- Reduced-motion and focus-visible behaviour inherited from the workspace
  root; no fake or unwired controls.

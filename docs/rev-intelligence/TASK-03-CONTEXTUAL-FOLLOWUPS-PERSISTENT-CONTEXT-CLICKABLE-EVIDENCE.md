# Rev Intelligence — Contextual Conversation and Evidence UX

Status: IN PROGRESS  
Scope: contextual follow-ups, durable conversation context handoff, and clickable evidence references.

## Product outcome

Rev should feel like a continuing merchant investigation, not a series of disconnected prompts. A follow-up must be grounded in the current investigation and the evidence actually returned. When Rev cites a fact, the merchant should be able to open the exact evidence record behind it.

## Existing foundation retained

- Node persists user and Rev messages in `conversation_messages`.
- Conversation history is organization-scoped and reloadable by URL.
- Python stores a bounded `summary` and `context_window` on the conversation.
- The context window retains the last investigation, reporting period, evidence IDs, currencies, segment and unresolved items.
- Evidence records already carry stable IDs and are persisted with the answer.

Do not introduce a parallel transcript store, duplicate memory table, or new database migration for this work.

## Work items

### 1. Context-aware follow-ups
- Replace intent-only canned suggestions with suggestions derived from returned evidence metrics, comparisons, and known unknowns.
- Never suggest mobile, returning-customer, product, refund, or traffic analysis unless the current result contains supporting data or clearly labels the missing data needed.
- Keep suggestions concise, non-repetitive and limited to three.

### 2. Persistent conversation context
- Node must pass the authenticated conversation's persisted summary and context window to Python as approved context.
- Python prefers this bounded Node-supplied context and falls back to its own organization-scoped database read for compatibility.
- Keep the transcript in Node; do not send secrets, access tokens, customer PII or raw exports in the context payload.
- Preserve the last investigation, period, evidence references, currencies and unresolved questions across turns and reloads.

### 3. Clickable evidence
- Render source references associated with verified facts in the answer.
- Clicking a source opens the evidence drawer and expands the exact evidence record.
- Keep citations limited to IDs actually present in the current answer's evidence payload.
- Do not fabricate links to Shopify admin objects or expose raw customer/order details.

## Acceptance criteria

- Follow-ups differ when evidence/unknowns differ; no unsupported segment prompts.
- A follow-up in the same conversation retains the prior investigation intent and reporting context.
- A refreshed conversation continues from the persisted server-side context.
- Node passes only organization-scoped, bounded context to Python.
- Every rendered source button maps to a real evidence ID in the same response.
- Clicking a source opens the drawer with that exact record expanded.
- Tests cover contextual follow-up selection, context hydration, evidence reference rendering and selection.
- Frontend production build, backend tests and Python tests pass.
- No write actions, new autonomous behavior, schema changes, or merchant-data side effects.

## Security and correctness constraints

- Tenant scope comes only from authenticated Node context.
- Store content and merchant messages remain untrusted data, not instructions.
- Evidence references are response-local and cannot be used to request another merchant's data.
- Rev remains read-only.

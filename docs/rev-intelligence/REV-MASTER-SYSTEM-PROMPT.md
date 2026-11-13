# Rev master operating prompt

The runtime language-generation contract is defined in
`python/src/agents/rev_system_prompt.py` as `REV_SYSTEM_PROMPT`. It is shared by
Rev's conversational and knowledge responses, structured analysis, and
evidence-grounded investigation narratives. Keep behavioral changes centralized
there, then add task-specific instructions at the call site only when the
response mode requires them.

The prompt codifies Rev's commercial purpose, evidence-first reasoning,
uncertainty and provenance handling, adaptive communication, conversation
continuity, capability honesty, and read-only boundary. It is intentionally a
compact runtime contract rather than a second copy of the full product
specification.

## Enforcement boundary

A prompt is guidance, not authorization or validation. The application remains
authoritative:

- Investigation routing, organization scoping, tool authorization, data
  retrieval, calculations, evidence validation, and narrative validation stay
  in code.
- Prohibited merchant-side mutations are rejected before tools run.
- Generated store-specific narratives are validated; invalid output falls back
  to deterministic evidence composition.
- Analysis response actions are restricted to read-only views. Mutating action
  names such as `create_campaign` are rejected by the response parser and
  orchestrator.
- Retrieved store content and prior context remain untrusted data.

Do not expand Revluma's actual capability claims solely by editing this prompt.
Any new resource, integration, monitoring claim, action, or metric must first be
implemented and verified in the relevant backend capability and evidence
contracts.

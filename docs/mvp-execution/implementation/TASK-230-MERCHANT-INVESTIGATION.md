# Task 230 — implementation in progress

- `workspaceNavigation.ts` preserves only a sanitized local return hint through Rev conversation resume, creation, switching, new chat and explicit topic changes. `RevIntell.tsx` offers an explicit return control. `CommandCenterSections.tsx` retains a UUID-shaped selected finding as a navigation hint; this is not authorization. `Overview.tsx` uses only a finding present in the newly fetched response or a fixed section whitelist to restore position.
- `useCommandCenter.ts` ignores obsolete timed-out requests when a newer request owns the lifecycle. Tests exercise late timeout settlement and subsequent refresh.
- `question_orchestration.py` respects an explicit router `followup: false`; explicit follow-ups still inherit and expand context. This does not prove that every classifier, selected-finding transition, or end-to-end question routes correctly.
- No change to RLS, commerce write routes or external merchant actions. The Task 228 uncommitted OAuth changes are excluded from this implementation and are not being deployed by this task.

No merge, migration or deployment is asserted. Complete review and the requested real-data acceptance remain outstanding.

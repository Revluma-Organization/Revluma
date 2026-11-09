# Task 226 implementation — workspace consistency, language and accessibility

## Original task mapping

- **317:** `lib/workspaceDesign.ts` defines shared color, typography, spacing, shape, controls, focus and breakpoints. Command Center tokens derive hierarchy from it; Integrations and merchant journey use its controls; Rev uses its focus color.
- **318:** `lib/workspaceCommunication.ts` maps typed backend codes and HTTP states to closed merchant messages and resource language. Integrations and Rev no longer display raw provider failures through their changed paths.
- **319:** `REQUIRED_VIEWPORTS` covers 320, 360, 375, 390, 430, 600, 768, 820, 1024, 1280, 1440 and 1920. Existing shared drawer/sidebar behavior is retained; page containers keep compact padding and horizontal clipping.
- **320:** shared `focus` uses a two-pixel visible ring and offset. Integrations now uses the Radix dialog primitive for keyboard trapping, Escape and focus restoration, with a labelled domain input and 44px controls.
- **321:** `contrastRatio` implements WCAG relative luminance. Computed tests cover normal/large text, buttons, inputs, placeholders, focus, meaningful borders, icons, links, muted text, badges and chart labels. Status labels never rely on color alone.

## Shared status and errors

`components/workspace/WorkspaceStatus.tsx` supports loading, empty, partial, error and success states. Error uses one assertive announcement; non-error states use one polite announcement. Decorative icons are hidden from assistive technology. Retry is opt-in and can be disabled while running. Integrations uses it for store-list failure.

The language contract distinguishes disconnected, unauthorized, synchronizing, stale, partial, unsupported, failed, unknown and insufficient history. Actions are typed as retry, reconnect, sign-in, wait, review or none. Provider payloads and stack traces are never interpolated.

## Preserved product behavior

No workspace was made identical to another. Command Center retains evidence/finding navigation and loses only its invalid nested-main landmark. Rev retains investigation, evidence, confidence and read-only behavior while sharing common failure language. Integrations retains backend-derived connection and resource states. No backend or production fixture was introduced.

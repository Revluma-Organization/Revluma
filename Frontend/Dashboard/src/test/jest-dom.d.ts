// Type-only: the @testing-library/jest-dom matchers for vitest's `expect`.
//
// The matchers are loaded at RUNTIME by src/test/setup.ts; this declaration
// provides the corresponding type augmentation for the `vitest` module so
// test files that `import { expect } from "vitest"` see the matchers
// (toBeInTheDocument, toHaveTextContent, toBeDisabled, ...). It has no
// runtime effect and does not alter the `types` compiler option.
import "@testing-library/jest-dom/vitest";

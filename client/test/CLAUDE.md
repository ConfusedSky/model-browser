# client tests

- Component tests: `// @vitest-environment happy-dom` pragma, render with plain react-dom
  (no testing-library), vi.mock `three/renderer` (no WebGL in tests) — see orbitHandoff.test.tsx
- Renderer mocks: spread `...(await importOriginal<typeof import('../src/three/renderer')>())`
  and override only what the test drives — hand-listed factories go stale on new exports, and a
  stubbed `stageModel` fails as `Cannot destructure property 'pivot' of undefined`
- Never re-declare RIG_VERSION's value in a mock — a literal silently masks a bump (rig.test.ts
  pins the expected value; everywhere else tracks it via the spread)

# Conventions

## TypeScript and Module Style

- The repo uses ESM throughout (`"type": "module"` in `package.json`).
- Imports are relative and mostly flat.
- Types are explicitly imported where useful, especially in `src/hooks/` and `src/ai/`.
- Domain types are often defined close to their usage instead of in one centralized schema package.

## State and Hook Patterns

- Zustand stores expose both raw state and imperative actions.
- Long-running flows are modeled as explicit status machines rather than inferred booleans.
- `useConversation.ts` and store files use extensive inline comments describing regressions and test IDs.
- `useActivePipeline.ts` extracts pure computation into `computeActivePipeline(...)` for easier testing.

## Error Handling

- Gemini-specific failures use a custom `GeminiError` class in `src/ai/gemini.ts`.
- Apify-specific failures use a custom `ApifyError` class in `src/lib/apifyCore.ts`.
- User-facing error messages are generally sanitized before display.
- There is a convention of graceful degradation in a few places, especially discovery expansion and hashtag fallback flows.

## UI and Styling

- Tailwind utility classes are used heavily in page and component JSX.
- Design tokens are defined once in `src/shared/styles/tokens.css` and mirrored into Tailwind theme extensions.
- The current design language favors warm neutrals, saffron accent, and serif/sans/mono font roles.
- Comments in UI files often reference acceptance-test IDs such as `T7`, `T14`, `AD10`, and `D6`.

## Testing Style

- Tests are colocated with implementation files.
- Many tests are narrow and scenario-driven rather than snapshot-heavy.
- The suite validates pure helpers, hooks, prompt generation, parser robustness, and store transitions.
- There is clear intent to encode bug regressions directly in comments and targeted tests.

## Commenting Style

- Comments are plentiful and usually high-signal.
- Files often start with large header comments describing lifecycle, invariants, or design rationale.
- Regression identifiers are embedded directly in comments, which helps trace history but also makes files verbose.

## Current Convention Breaks

- Lint errors show a few active convention violations:
  - unused imports/variables in tests
  - missing `cause` on rethrown errors
  - React purity warnings around `Date.now()` in render-sensitive code
  - one unnecessary regex escape and one useless assignment
- Some test fixtures still use fields like `private` that no longer match the live normalized-profile type.

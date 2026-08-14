# Changelog

## 0.6.0

Tooling and test coverage. No user-facing behaviour changed.

### Added

- **Typed message keys.** `src/generated/i18n-keys.ts` is generated from the
  English locale, so `t("statusFoo")` for a key that does not exist is a compile
  error. The i18n checker shrank to what types cannot see: locale parity,
  placeholder declarations, and `data-i18n` bindings in HTML.
- **ESLint (`strictTypeChecked`), stylelint and Prettier**, wired into
  `npm run check` and CI. Three lint suppressions remain, each with a comment
  explaining why the rule is wrong for that line.
- **Shared design tokens** in `src/shared/tokens.css`, linked by the extension
  pages and inlined into the panel's shadow root. The palette was previously
  duplicated across four stylesheets.
- **Tests for the parts that had none**: field capture and insertion under
  happy-dom, the port protocol (ids, stale replies, one run at a time,
  cancellation on disconnect), and the executor chain falling through four APIs.
  41 tests in total, up from 14.
- **Bundle size budget** (`scripts/check-size.mjs`), a pre-commit hook installed
  by `npm install`, `SECURITY.md`, `CODEOWNERS` and Dependabot.
- CI uploads the built `dist/` as an artifact, so a reviewer can load the
  extension without building it.

### Fixed

- The first draft of the design tokens declared the light-mode button variables
  _after_ the dark-mode block, so dark mode silently lost them.
- `errorMessage()` replaces the `String((error as Error)?.message ?? error)`
  pattern that appeared in three places and lied to the type checker about what
  the AI APIs actually throw.

## 0.6.0

Tooling and test coverage. No user-facing behaviour changed except the
`execCommand` guard below.

### Added

- `MessageKey` is generated from the English locale and `t()` is typed against
  it, so a mistyped or removed message key fails the build. CI verifies the
  generated file is current.
- ESLint with type-aware rules, stylelint, and Prettier, all wired into
  `npm run check` and CI.
- Tests for the port protocol (request ids, cancellation, error paths), for the
  executor chain degrading when APIs are missing, and for field capture and
  insertion against a real DOM. 41 tests in total, no browser required.
- `resetSessions()` so tests do not carry a session between cases.
- A bundle budget, checked on every build.
- `SECURITY.md` naming what counts as a vulnerability here, `CODEOWNERS`,
  Dependabot, and an opt-in pre-commit hook.

### Fixed

- `document.execCommand` was called without checking it exists. It is deprecated
  and will eventually be removed; its absence now falls through to the value
  setter instead of throwing. Found by the new DOM tests.

## 0.5.0

Rewritten in TypeScript with a real build, a modular source tree and separated
stylesheets. No user-facing behaviour changed; everything below is structural.

### Changed

- Source is now TypeScript, bundled by esbuild into `dist/`. The service worker
  is an ES module split across files; the content script is bundled to a single
  IIFE because Chrome injects it as a classic script.
- The port protocol lives in `src/shared/messages.ts` as a discriminated union,
  so a reply the panel does not handle, or a field the worker never sets, is a
  compile error rather than a silent no-op.
- The content script is split into field capture (`target.ts`), a shadow-DOM view
  with no protocol knowledge (`panel.ts`), the port client (`client.ts`) and
  coordination (`index.ts`).
- The AI layer is one file per concern: probing, sessions, detection, limits and
  the four execution routes.
- Panel CSS is a real stylesheet, imported as text and inlined into the shadow
  root; the extension pages link ordinary `.css` files.
- `npm run check` now typechecks, asserts manifest invariants, verifies i18n
  completeness and runs the tests. Tests are TypeScript, executed directly by
  Node's type stripping — no test build step.

### Fixed

- Insertion through the value-setter fallback silently loses undo. The panel now
  says so instead of letting the user discover it by pressing Cmd+Z.

## 0.4.1

### Fixed

- Switching presets mid-stream interleaved two generations into the same box.
  Every request now carries an id, replies are tagged with it, and the worker
  aborts the previous run before starting a new one.
- Custom presets were stored as one `customPresets` array. `chrome.storage.sync`
  caps a single item at 8 KB, so saving would have started failing silently
  around the eighth long preset — and the failure was not caught or shown. Each
  preset is now its own key, instructions are capped at 500 characters, and a
  failed save says so. Existing presets are migrated on update.
- The input-length check only covered the Prompt path, so the Rewriter and
  Translator presets could be handed a whole article. It now runs before a route
  is chosen.
- Language gating ignored the detector's confidence, so a three-word comment
  could strike out "Fix the English only" on a coin-flip guess. Gating now
  requires confidence of at least 0.5, and `en-GB` counts as English.
- Closing the panel left the model generating into a disconnected port. Runs are
  now cancelled with an `AbortSignal`.
- The panel could not fit inside a narrow iframe; there is now a compact layout
  below 470px.
- Opening the picker left focus in the page, making the chips unreachable
  without tabbing through the whole document.

### Added

- Four presets: cut the hedging, as bullet points, less formal, and fix typos
  only — the last one proofreads in whatever language you are writing.

## 0.4.0

- Removed all host permissions. The panel is injected on demand via `activeTab`
  and `scripting`, so the extension works on every site while requesting
  standing access to none.
- Field detection no longer relies on `document.activeElement` at click time.
- Input size measured against the session's quota instead of a character count.
- Added the Proofreader API to the execution chain.
- Model download moved to the toolbar popup, which has the user activation a
  service worker lacks.
- Added a toolbar popup, an options page for user-defined rewrites, and a
  first-run welcome page.
- Localised into English, German and Russian.

## 0.3.1

- Initial prototype: context menu, keyboard shortcut, five presets, streaming
  output over a port, session caching with recovery from destroyed sessions.

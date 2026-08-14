# Changelog

## 0.6.0

First public release. Tooling, test coverage, and the security work that turns
the privacy claims from something the author promises into something the browser
enforces.

### Security

- **Content Security Policy** on every extension page and the service worker:
  `connect-src 'none'`, `img-src 'self'`, `object-src 'none'`. The docs used to
  say that declaring no host permissions would stop an outgoing request. It
  would not — that blocks reading the response, and one-way exfiltration never
  needs one. `npm run check` now fails if the directives are dropped, and ESLint
  rejects `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` and
  `sendBeacon` anywhere in the source, which is what covers the injected panel
  the CSP cannot reach.
- **The panel's shadow root is closed**, so page script can no longer read the
  draft or click Insert through `host.shadowRoot`.
- **Locale strings are set as text and attributes**, never interpolated into
  markup. Translations are the one untrusted input that reaches the panel;
  `npm run check` also rejects a translation containing `<` or `>`.

### Added

- **Typed message keys.** `src/generated/i18n-keys.ts` is generated from the
  English locale, so `t("statusFoo")` for a key that does not exist is a compile
  error. CI verifies the generated file is current.
- **ESLint (`strictTypeChecked`), stylelint and Prettier**, wired into
  `npm run check` and CI.
- **Shared design tokens** in `src/shared/tokens.css`, linked by the extension
  pages and inlined into the panel's shadow root. The palette was previously
  duplicated across four stylesheets.
- **Tests for the parts that had none**, from 14 to 91: field capture and
  insertion under happy-dom, the port protocol, the executor chain, the panel's
  end of the port, session recovery, menu rebuilds, injection and delivery, and
  the coordination between them. No browser required.
- **CI and a release workflow.** Every push runs the checks and uploads the
  built `dist/` as an artifact, so a reviewer can load the extension without
  building it. A `v*` tag refuses to build unless it matches the manifest
  version, then attaches the store zip.
- A bundle size budget, a pre-commit hook installed by `npm install`,
  `SECURITY.md`, `CODEOWNERS`, Dependabot, `.editorconfig`, and a Node version
  guard so `npm test` says what is wrong instead of failing inside a test file.
- Presets that do not depend on the detected language — six of the nine
  built-ins — no longer wait up to three seconds for detection before starting.

### Fixed

- **Two detections in flight left the panel stuck.** A single pending slot let
  one request's timeout consume another's resolver, so `detect()` never
  returned and the panel sat on "checking the language" with every button,
  including Retry, disabled until it was closed. Reproducible on the first run,
  while the language pack downloads.
- **Insertion no longer overwrites work done while the model was thinking.** The
  captured offsets and range are checked against the field before anything is
  written, in plain fields and rich editors alike, including the case where an
  editor rebuilt its nodes and left the text identical. The panel says the field
  changed instead of silently cutting the wrong range.
- **The lost-undo warning is actually visible.** It was written into a panel
  removed from the page in the same frame, so nobody ever read it.
- **A right-click in an iframe opens one panel, not two.** The menu message is
  delivered to the frame Chrome says was clicked, rather than broadcast to all
  of them and settled by a timing heuristic.
- **Saving presets no longer half-rebuilds the context menu.** Two storage
  events arrived together and the interleaved rebuilds hit duplicate ids, which
  vanished into `runtime.lastError` with nothing reading it.
- Failures reach the panel in the user's language instead of as an English
  `DOMException` message.
- The keyboard focus ring on the panel is drawn: later, less specific rules were
  overriding it.
- A preset label containing `%s` no longer picks up the selected text.
- The language detector is given the first 1000 characters rather than the whole
  of a long `contenteditable`.
- `document.execCommand` was called without checking it exists. Its absence now
  falls through to the value setter instead of throwing.
- The first draft of the design tokens declared the light-mode button variables
  _after_ the dark-mode block, so dark mode silently lost them.
- `errorMessage()` replaces the `String((error as Error)?.message ?? error)`
  pattern that appeared in three places and lied to the type checker about what
  the AI APIs actually throw.

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

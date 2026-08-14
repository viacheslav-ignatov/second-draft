# Contributing

Thanks for taking a look.

## Ground rules

**No network requests.** Not for telemetry, not for error reporting, not for a
"better model when available". The manifest has no host permissions and that is
the product, not a setting. A PR that adds one will be closed.

**No new permissions** without a concrete user-visible reason in the PR
description. Every permission has to be justified to the Chrome Web Store on
every submission, and each one makes the listing scarier.

**One purpose.** The extension rewrites text the user typed into a field. Not
summarising pages, not chatting, not translating whole documents. The store's
single-purpose policy is one reason; the other is that the on-device model is
small, and every added surface makes it look worse.

## Getting set up

```bash
npm install
npm run dev     # esbuild watch, then load dist/ unpacked
npm run check   # what CI runs
npm run format  # fixes most lint and formatting complaints
```

`npm install` installs a pre-commit hook that runs `npm run check`. Delete
`.git/hooks/pre-commit` to opt out; `scripts/install-hooks.mjs` never overwrites
a hook you already have.

`npm run check` is typecheck, lint, formatting, generated-type freshness,
manifest invariants, i18n completeness and tests. CI runs the same thing on every
PR, with `npm run build` before it and the bundle budget after — the manifest
check inspects the built output, and the budget needs something to measure.

Message keys are typed: `t("someKey")` only compiles if the key exists in
`src/static/_locales/en/messages.json`. After adding or renaming one, run
`npm run gen:i18n` and commit the regenerated
`src/generated/i18n-keys.ts`.

## Where code goes

- `src/shared/` — anything both the worker and the page need. Pure logic lives in
  `rules.ts` and is tested; if your change decides _whether_ to do something
  (gating, limits, validation), it probably belongs there with a test next to it.
- `src/shared/messages.ts` — the port protocol. Adding a message means adding it
  to the union, which makes both ends fail to compile until they handle it. That
  is the point.
- `src/background/ai/` — one file per concern: probing, sessions, detection,
  limits, execution routes. New AI surfaces go in `executors.ts` as another route
  in the chain, returning `null` when unavailable.
- `src/content/` — `target.ts` is DOM behaviour, `panel.ts` is a view with no
  protocol knowledge, `client.ts` owns the port, `controller.ts` decides what
  happens in what order, and `index.ts` is wiring only. Keep that separation; it
  is what makes the panel readable, and it is why the controller can be tested
  without a DOM.

## Adding a preset

`BUILTIN` in `src/background/presets.ts`: a label key plus an instruction,
optionally a Rewriter config and a language restriction. Add the label to all
locales.

Presets specific to one company or team do not belong in the shipped build —
they belong in the options page, on the user's own machine.

## Adding a language

Copy `src/static/_locales/en/messages.json` into a new folder and translate the
`message` values. Leave the keys and the `placeholders` blocks alone.
`npm run check` will tell you if you missed one.

Adding or removing a message means running `npm run gen:i18n` and committing
`src/generated/i18n-keys.ts` alongside it; CI fails if the two disagree.

## Style

The code is commented where a decision is non-obvious and silent where it is not.
If a line looks strange — `execCommand`, the closed shadow root, the defensive
global lookups — there should be a comment saying why, and if you change one of
those, keep the reason up to date.

Prefer a small pure function in `shared/rules.ts` over a clever conditional
inline. It costs one export and buys a test.

Tests live in `tests/`, run with Node's own type stripping, and use the doubles
in `tests/helpers/doubles.ts` — a fake port, a storage stub and a cancellable
fake model. DOM behaviour is tested against happy-dom. If you touch `target.ts`
or `port.ts`, add a case: those two files are where every shipped regression has
come from so far. Write the case so it fails against the code you are about to
change, then fix it — a test that passes on the bug is documentation.

## Reporting a bug

Include your Chrome version, your OS, and what `chrome://on-device-internals`
says about the model. Most "it does nothing" reports turn out to be a machine
that cannot run the model at all.

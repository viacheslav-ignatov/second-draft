Store and README screenshots, all 1280×800:

- `panel.png` — the panel open beside a review comment box, the original above
  and the rewrite below. The README embeds this one.
- `presets.png` — German text, so "Fix the English only" is struck through with
  the reason while "Translate to English" stays live. This is the shot that shows
  the extension exercising judgement rather than listing buttons.
- `custom.png` — a preset the user wrote themselves, sitting in the chip row next
  to the built-in ones and used for the rewrite on screen.
- `options.png` — that preset being written, with its English-only switch.
- `popup.png` — the model status reading "Ready", and the line about nothing
  leaving the machine.

Shot on a light background at 100% zoom, with no marketing text over them: the
store frames them in its own layout and the README in another. Sizes were
normalised by padding rather than cropping, so nothing is cut off mid-word.

Still to make: the promo tile at 440×280 — the icon, the name, and one line.

`../icon-512.png` is the large icon the store listing wants. It lives there
rather than in `src/static/icons/` because the extension itself never loads it —
the manifest references 16, 32, 48 and 128 — and anything under `src/static/`
ships inside the package.

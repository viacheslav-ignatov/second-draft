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

Two more listing assets live one directory up, for the same reason the shots
here do not ship: the extension never loads them.

- `../promo-tile.png` — the small promo tile, 440×280. The icon at 88px, the
  name, and one line, on white; the store draws its own frame around it, so it
  needs no border of its own. Remake it the same way if the icon changes.
- `../icon-512.png` — the large icon the listing wants. It is not in
  `src/static/icons/` because the manifest references only 16, 32, 48 and 128,
  and everything under `src/static/` ships inside the package.

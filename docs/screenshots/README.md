Store and README screenshots go here, at 1280×800:

- `panel.png` — the panel mid-rewrite next to a real comment box, with the text
  still streaming. This is the one that does the explaining; the README embeds it.
- `presets.png` — the chips, including a struck-through preset showing the
  language gating. It shows judgement rather than a feature list.
- `options.png` — a custom preset being written.
- `popup.png` — the model status reading "Ready".

Shoot them on a light background at 100% zoom, and leave marketing text off them:
the store frames them in its own layout, and the README in another.

The store also wants a promo tile at 440×280 — the icon, the name, and one line.

`../icon-512.png` is the large icon the store listing wants. It lives here rather
than in `src/static/icons/` because the extension itself never loads it — the
manifest references 16, 32, 48 and 128 — and anything under `src/static/` ships
inside the package.

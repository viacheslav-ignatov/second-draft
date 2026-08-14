# Privacy

Second Draft sends nothing anywhere, and that is enforced rather than promised:
the manifest declares no host permissions and sets `connect-src 'none'`, the
build asserts that directive on every run, and the linter rejects the network
APIs anywhere in the source. It reads the field you invoke it on, only at the
moment you invoke it, and stores nothing but the rewrite presets you write
yourself.

**The full policy is [`docs/privacy-policy.html`](docs/privacy-policy.html)**,
published at
<https://viacheslav-ignatov.github.io/second-draft/privacy-policy.html> — that is
the copy the Chrome Web Store listing points at, and the one to edit. This file
is deliberately only a summary: two privacy policies that can disagree with each
other are worse than one.

Where each of those guarantees comes from, and where it stops, is in
[SECURITY.md](SECURITY.md).

Questions: <https://github.com/viacheslav-ignatov/second-draft/issues>.

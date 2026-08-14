# Privacy Policy

**Second Draft** — last updated 13 August 2026.

## Short version

The extension sends nothing anywhere, and that is enforced rather than promised.
The manifest declares no host permissions, and the extension's Content Security
Policy sets `connect-src 'none'` and `img-src 'self'`, so Chrome refuses `fetch`,
`XMLHttpRequest`, `WebSocket` and `sendBeacon` from the service worker and from
every extension page. The source contains no network call of any kind, the build
asserts the CSP on every run, and the linter rejects a commit that introduces one.

One boundary is worth stating plainly: the panel injected into a web page runs
under that page's Content Security Policy, not the extension's, so there the
guarantee rests on the source, the linter and the review rather than on Chrome
refusing the call. The source is public and the check is one command — see
[SECURITY.md](SECURITY.md).

## What the extension reads

When you invoke it — by pressing the keyboard shortcut or choosing Second Draft
from the right-click menu — it reads the text in the field you are editing, or
your selection within that field. It reads nothing else on the page, and it reads
nothing at all until you invoke it.

## What it does with that text

The text is passed to Chrome's built-in on-device model, which runs locally on
your computer as part of the browser. The rewritten result is shown to you and is
inserted into the field only if you press Insert.

## What it stores

Only the rewrite presets you create yourself on the options page, in
`chrome.storage.sync` — Chrome's own storage, synced across your Chrome profile if
you have sync enabled. The extension does not store the text you rewrite, the
drafts it produces, or any history of your use.

## What it transmits

Nothing. There are no servers, no analytics, no error reporting, no advertising,
no third-party services. The extension makes no network requests.

## Permissions

- `contextMenus` — adds the right-click entry point on editable fields.
- `activeTab` — access to the current tab, granted by Chrome only at the moment
  you invoke the extension, and only for that tab.
- `scripting` — injects the panel into the tab you invoked the extension on.
- `storage` — your own presets, as described above.

## Children

The extension is not directed at children and collects no data from anyone.

## Changes

Any change to this policy will appear in this file, whose history is public in the
repository.

## Contact

Open an issue at <https://github.com/viacheslav-ignatov/second-draft/issues>.

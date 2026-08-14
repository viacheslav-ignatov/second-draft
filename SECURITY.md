# Security

## Threat model

Second Draft reads text you have typed and hands it to a model that runs inside
your browser. It has no server, no account and no network access, so the classic
extension risks — exfiltration, a compromised backend, a rotated API key leaking
your data — do not apply. What remains is worth stating plainly.

**The extension can read a field you invoke it on.** Only that field, only in the
tab where you invoked it, and only at that moment: access comes from `activeTab`,
which Chrome grants per invocation. There is no standing permission for any site.

**It writes into that field.** The text you accept is inserted where your cursor
was. It never submits a form or clicks anything.

**Your custom presets sync.** They live in `chrome.storage.sync`, which means
Chrome replicates them across machines signed into your profile. Do not put
secrets in a preset instruction — it is configuration, not a vault.

**The model is Chrome's.** Downloading and running it is the browser's business.
This extension does not bundle, patch or update model weights.

**Text from a page you do not control can steer the model.** Rewriting your own
draft is the normal case, but you can also select someone else's text on a page
and ask for a rewrite of that. Whatever you selected goes into the prompt as it
is, so a page can be written to contain instructions rather than prose — and the
model may follow them instead of rewriting. The output is then sitting in the
panel, next to a button that puts it into your field.

This is inherent to feeding untrusted text to a language model, and no amount of
instruction in the system prompt fixes it: a prompt is a suggestion to the model,
not a boundary. What bounds it here is the shape of the extension. The panel
never inserts on its own — you read the draft and press Insert — and the worst a
successful injection can produce is text you were about to paste yourself. It
cannot reach the network, because there is none; it cannot execute, because the
draft is rendered as text, never as markup; and it cannot read anything beyond
the field you invoked on, because that is all the extension can see.

So: an accepted risk, listed here rather than left for you to discover. Treat a
rewrite of someone else's text the way you would treat anything else copied off a
web page — read it before you use it.

## Reporting a vulnerability

Open a [security advisory](https://github.com/viacheslav-ignatov/second-draft/security/advisories/new)
rather than a public issue. I will confirm within a week.

Things I consider vulnerabilities: any path that causes a network request; any
way for page script to reach into the panel's shadow root or drive an insertion;
any way for a stored preset to escalate into script execution; a permission the
manifest requests but does not need; and any way for text taken off a page to
achieve more than appearing in the panel as a draft — inserting itself, running
as markup, or reaching anything outside the field you invoked on.

Things I do not: the on-device model producing bad output, hardware requirements
excluding a machine, a site whose editor the insertion logic cannot handle, or
the model following instructions hidden in text you asked it to rewrite. That
last one is real and is described in the threat model above; it is bounded by the
draft never being inserted without you, not by the model being persuaded to
behave.

## Verifying the claims yourself

```bash
grep -r "fetch\|XMLHttpRequest\|WebSocket\|sendBeacon" src/   # nothing
node -p "require('./src/static/manifest.json').host_permissions"  # undefined
node -p "require('./src/static/manifest.json').content_security_policy.extension_pages"
```

`npm run check` asserts the manifest invariants on every run, so a change that
adds a host permission, a declared content script, or that drops `connect-src
'none'` from the CSP fails the build. ESLint rejects `fetch`, `XMLHttpRequest`,
`WebSocket`, `EventSource` and `navigator.sendBeacon` anywhere in `src/`.

The CSP governs the service worker and the extension's own pages. It does not
reach the panel injected into a web page: a content script runs under the page's
policy, and its `fetch` is exempt even from that. There the guarantee is the
`grep` above, the lint rule and this review process — which is why the source is
public.

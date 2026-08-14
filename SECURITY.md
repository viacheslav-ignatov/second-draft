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

## Reporting a vulnerability

Open a [security advisory](https://github.com/viacheslav-ignatov/second-draft/security/advisories/new)
rather than a public issue. I will confirm within a week.

Things I consider vulnerabilities: any path that causes a network request; any
way for page script to reach into the panel's shadow root or drive an insertion;
any way for a stored preset to escalate into script execution; a permission the
manifest requests but does not need.

Things I do not: the on-device model producing bad output, hardware requirements
excluding a machine, or a site whose editor the insertion logic cannot handle.

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

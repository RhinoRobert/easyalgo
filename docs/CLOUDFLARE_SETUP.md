# Putting Cloudflare in front of GitHub Pages (security headers for easyalgo.org)

GitHub Pages serves the site over HTTPS but cannot send custom response headers. A page that asks people to sign transactions needs them
(no framing, no inline script, a locked-down list of places it may talk to), so Cloudflare sits in front and adds them.

The header values live in **one file**, [`deploy/security-headers.json`](../deploy/security-headers.json). `npm run check:headers` compares the live site with it, and a
unit test keeps this page in step with it. If you change a header, change the JSON first and copy the value here.

## What each header is for

| Header | Value | Why |
|---|---|---|
| `Content-Security-Policy` | see below | Only this site's own script may run; connections only to the Algorand API (Algonode) and Pera Wallet; nothing may frame the page |
| `X-Frame-Options` | `DENY` | Same framing ban for older browsers (clickjacking: tricking a click on a hidden wallet page) |
| `X-Content-Type-Options` | `nosniff` | Browsers must not guess a file's type |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Other sites only ever learn this site's name (never the path or anything after it), and only over HTTPS. This is what lets the main website see that visitors came from here |
| `Permissions-Policy` | camera, microphone, geolocation, payment, usb, serial, bluetooth all off | The app needs none of them |
| `Strict-Transport-Security` | set with the HSTS switch (step 6), at least 6 months | Browsers only ever use HTTPS for the domain |

### The policy, directive by directive

```
default-src 'none'
script-src 'self'
style-src 'self' 'unsafe-inline'
img-src 'self' data:
font-src 'self'
connect-src 'self' data: https://mainnet-api.algonode.cloud https://mainnet-idx.algonode.cloud https://wc.perawallet.app https://*.perawallet.app wss://*.perawallet.app
frame-src 'none'
base-uri 'none'
form-action 'none'
object-src 'none'
manifest-src 'self'
frame-ancestors 'none'
```

* `script-src 'self'` means no inline script and no `eval`. The production build contains neither, so a script injected by someone else would simply not run.
* `style-src ... 'unsafe-inline'` is the one concession: Pera Wallet's connect dialog and React write inline styles. It does not allow script.
* `connect-src` is the allow-list of everything the page may talk to: the Algonode API and indexer, Pera's configuration (`wc.perawallet.app`) and its wallet bridge servers
  (`wallet-connect-a` to `-h.perawallet.app`, over HTTPS and WebSocket). Testnet endpoints are deliberately absent: this site is MainNet only.
  `data:` is there because the dialog builds its QR code from a data URL.
* Google Fonts is deliberately **not** allowed. Pera's dialog asks for the Inter font from Google; blocked, it uses a plain fallback font and nothing is sent to Google.
* The policy was tested on 2026-10-25: the production build served locally with exactly these headers loaded with **zero** violations, and Pera's connect dialog opened and
  drew its QR code. The only blocked request was the Google font above. What this test did **not** cover: a full connect-and-sign round trip with a wallet, and "Connect With Pera Web"
  (opens `web.perawallet.app` in a new window). Do both once with the policy in report-only mode before enforcing it (step 8).

## Steps

### 1. GitHub side (already done)
Pages source = GitHub Actions (`.github/workflows/pages.yml`), custom domain `easyalgo.org`, HTTPS enforced, repository public.

### 2. Add the domain to Cloudflare
1. Create a Cloudflare account and **turn on 2FA first**.
2. Add a site, enter `easyalgo.org`, choose the **Free** plan.
3. Cloudflare shows two nameservers. At your domain registrar, replace the existing nameservers with them. Propagation takes minutes to hours.

### 3. DNS records (DNS only at first: grey cloud)
| Type | Name | Content |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `rhinorobert.github.io` |

Keep these on **DNS only** until step 4 is finished. GitHub cannot (re)issue its certificate while the proxy is on.

### 4. Make sure GitHub has its certificate
Repo → Settings → Pages: the domain check must be green and **Enforce HTTPS** ticked. (It already was on 2026-10-24; the certificate expires 2027-01-22 and renews on its own, but only while DNS points at GitHub. If you ever see it fail, switch the records to DNS only, wait, switch back.)

### 5. Turn the proxy on
Switch the four `A` records and the `www` record to **Proxied (orange cloud)**.

### 6. SSL/TLS
* Mode: **Full (strict)** (never "Flexible": that would leave the hop to GitHub unencrypted).
* Always Use HTTPS: on. Automatic HTTPS Rewrites: on. Minimum TLS version: 1.2.
* HSTS (SSL/TLS → Edge Certificates): enable, max-age **6 months**, no subdomains, **no preload** until you are certain everything stays on HTTPS.

### 7. Add the response headers
Rules → Transform Rules → **Modify Response Header** → Create rule. Name it `security headers`, apply it to **all incoming requests**, and add these as **Set static**:

| Header | Value |
|---|---|
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()` |
| `Content-Security-Policy-Report-Only` | the policy above on one line, directives separated by `; ` (copy it from `deploy/security-headers.json`) |

Use **Report-Only** first (it logs problems and blocks nothing).

### 8. Test, then enforce
1. `npm run check:headers`. Everything should pass except "Content-Security-Policy is enforced" (it is Report-Only for now).
2. Open https://easyalgo.org with the browser console open. Press **Connect Pera**, connect and approve a harmless action with a real wallet, and try **Connect With Pera Web**.
   Look for lines starting "[Report Only] Refused to ...". Each one names a blocked address; either it is something the app should not be doing, or the policy needs that exact host added
   (add it to `deploy/security-headers.json` first, then here).
3. When the console is clean apart from the Google font line, edit the rule: rename the header from `Content-Security-Policy-Report-Only` to **`Content-Security-Policy`**.
4. `npm run check:headers` again: all checks must pass. Also run https://securityheaders.com/?q=easyalgo.org and https://observatory.mozilla.org for a second opinion.
5. Repeat step 2 once more with the enforcing policy and one real canary launch.

### 9. Caching
Vite's built files have content-hashed names, so Cloudflare can cache them for a long time. `index.html` must stay on a short cache: add a Cache Rule for `easyalgo.org/` and `/index.html` with
**Edge TTL: respect origin** (GitHub sends `max-age=600`). After a deploy that must reach everyone at once, Caching → Purge Everything.

### 10. Hardening that matters more than any header
The repository and the domain control what people are asked to sign. Protect them:
* 2FA (preferably a passkey or hardware key) on GitHub, Cloudflare and the registrar. Registrar **transfer lock** on.
* **DNSSEC**: Cloudflare → DNS → Settings → Enable DNSSEC, then add the DS record it shows at the registrar.
* DNS **CAA** records limiting who may issue certificates for the domain: `0 issue "letsencrypt.org"` (GitHub's) plus the CAs Cloudflare lists when you enable proxying.
* GitHub: branch protection on `main` (require a pull request and the passing "Deploy to GitHub Pages" check; no force pushes), and restrict who can edit workflows.
* Pin the actions in `.github/workflows/pages.yml` to full commit SHAs (they use version tags today).
* Turn on Dependabot alerts and security updates for the repository.

### Rolling back
Headers: disable or delete the Transform Rule; the site keeps working, only unprotected. DNS: set the records back to DNS only to bypass Cloudflare entirely.

## What this does not protect against
Headers stop a lot of web attacks; they do not stop a compromised GitHub account, domain or Cloudflare account from publishing a malicious page. The contract limits some damage
(the pool and assets are pinned, tokens are immutable) but a malicious page could still ask people to approve transactions they should not. The app also checks the contract it talks to
against the reviewed bytecode hash before it signs anything (`src/launchpad/attestation.js`), which defeats a page pointed at a different contract. Anyone can run
`npm run verify:deployed` to check the deployed contract themselves.

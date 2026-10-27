# qr-code-studio

Make, design, check and read QR codes entirely in the browser. Nothing is
uploaded, nothing is stored unless you ask for it, and there is no server in
the path between a printed code and where it goes, so nothing can switch it
off.

Zero runtime dependencies. CHANGELOG.md records what each release changed.

## The offline app

`qr-code-studio.html` is the whole studio in one file. Download it from a
release, open it from your own disc, and turn your network off: every part of
it keeps working, because none of it ever needed the network.

Many QR code sites sell "dynamic" codes: the code points at their server,
which forwards to your link, and the forwarding stops when the subscription
does, usually after the code is printed. A code made in this file holds your
link itself. There is no server in between, so there is nothing to switch off.

What it does:

- Create makes a web link, text, Wi-Fi, a contact card, an email, a phone
  call, a text message, WhatsApp, a map location or a calendar event, with more
  kinds under one menu. Presets are drawn with your own code, and the module
  shapes, corner squares, colours and gradients (with a contrast reading), a
  logo, a frame with a caption and the printed size can all be changed. The
  code is shown as a printer's proof, at its true width once the screen is
  calibrated against a bank card.
- Codes save as SVG, PNG, PDF, EPS, JPEG or WebP, copy to the clipboard, or
  print at their physical size.
- Scan reads a code from the camera, a picture or a pasted screenshot, and can
  remake it as a code of your own.
- Bulk turns a CSV file into a ZIP of codes or a PDF of label sheets.
- The library keeps saved designs and brand kits in a `.qrlibrary.json` file
  you save and open. It holds the look of a code and never what the code says.

How to check what it does rather than take it on trust:

- The file's first lines carry a Content-Security-Policy that names the
  sha256 of its one script and its one stylesheet and refuses every connection
  (`default-src 'none'`, `connect-src 'none'`). Anything added to the file after
  it was built does not run.
- It keeps no cookies, no local or session storage, no database and no cache.
  The test suite opens the built file in Chromium, Firefox and WebKit, runs a
  whole session, and checks that no request left the page and nothing was left
  behind.
- Each release carries a `SHA256SUMS` file and a build provenance attestation,
  and the build is deterministic, so the file can be rebuilt from source and
  compared. RELEASING.md has the commands.

The file is also published in the npm package, as
`@hexpro/qr-code-studio/standalone.html`. To build it from a checkout:

```bash
pnpm install --frozen-lockfile
pnpm build:all
open dist/qr-code-studio.html
```

Micro QR and rectangular Micro QR are offered under Encoding for printing that
has no room for a QR code. Most phone cameras cannot read either, and the file
says so wherever one is chosen.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/hexpro-dev/.github/main/profile/assets/banner-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/hexpro-dev/.github/main/profile/assets/banner-light.png">
  <img alt="Hex Pro: Software for People" src="https://raw.githubusercontent.com/hexpro-dev/.github/main/profile/assets/banner-light.png" width="100%">
</picture>

<p align="center">
  <a href="https://hex.pro"><img alt="hex.pro" src="https://img.shields.io/badge/hex.pro-the%20company-0B76D9?style=flat-square&labelColor=1b2530"></a>
  <a href="https://apps.hex.pro"><img alt="apps.hex.pro" src="https://img.shields.io/badge/apps.hex.pro-apps%20%26%20tools-0B76D9?style=flat-square&labelColor=1b2530"></a>
  <a href="https://citadel.hex.pro"><img alt="citadel.hex.pro" src="https://img.shields.io/badge/citadel.hex.pro-file%20sync-0B76D9?style=flat-square&labelColor=1b2530"></a>
  <a href="https://games.hex.pro"><img alt="Hex Games" src="https://img.shields.io/badge/Hex%20Games-the%20game%20studio-9F9F9F?style=flat-square&logo=github&logoColor=white&labelColor=1b2530"></a>
  <img alt="Australian owned and operated" src="https://img.shields.io/badge/Australian-owned%20%26%20operated-9F9F9F?style=flat-square&labelColor=1b2530">
</p>

# QR Code Studio: Free QR Code Generator with Codes That Never Expire

Make, design, check and read QR codes entirely in the browser. Nothing is
uploaded, nothing is stored unless you ask for it, and there is no server in
the path between a printed code and where it goes, so nothing can switch it
off.

[![npm: @hexpro/qr-code-studio](https://img.shields.io/npm/v/@hexpro/qr-code-studio?style=flat-square&logo=npm&label=%40hexpro%2Fqr-code-studio&color=7cdf3a)](https://www.npmjs.com/package/@hexpro/qr-code-studio)
[![Use it online](https://img.shields.io/badge/apps.hex.pro-Use_it_online-7cdf3a?style=flat-square)](https://apps.hex.pro/tools/qr-code-generator)
[![Offline app](https://img.shields.io/github/v/release/hexpro-dev/qr-code-studio?style=flat-square&label=offline%20app&color=5ba3f5)](https://github.com/hexpro-dev/qr-code-studio/releases/latest)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-5ba3f5?style=flat-square)](LICENSE)
[![No runtime dependencies](https://img.shields.io/badge/runtime_dependencies-none-9b958c?style=flat-square)](package.json)

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

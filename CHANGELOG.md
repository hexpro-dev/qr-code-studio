# Changelog

## 0.1.0

The first published release: the library, the DOM adapters and the single-file
offline studio. The version stays below 1.0 until the public API has been
through api-extractor and a phone scan session has confirmed the scan check's
thresholds on printed codes.

- Encoding of QR Model 2 at versions 1 to 40, Micro QR and rectangular Micro
  QR, with optimal segmentation across numeric, alphanumeric, byte and kanji
  modes, ECI, FNC1 and structured append. Checked bit for bit against
  `qrcode`, `qrcode-generator` and `bwip-js`.
- A decoder for all three symbologies, with a strict profile held below
  zxing-cpp and jsQR: in a nightly corpus of 20,000 damaged captures, every
  code it reads is one they read too, apart from two cases the tests document,
  which zxing-cpp reads with its denoiser on.
- The scan check, which renders a design at its stated print size through
  simulated captures (distance, focus, angle, light, glare, ink spread), judges
  each with the strict reader, and reports the margins and the fixes that would
  pass.
- Versioned design JSON with migrations: 46 presets, 14 module shapes, 17
  corner square shapes, solid and gradient fills, 12 frames with captions set in
  a bundled font, 16 built-in icons and uploaded logos. Every entry, built in or
  added, has to pass the same conformance rules.
- 22 kinds of content, among them web links, Wi-Fi (WPA3, hidden networks,
  EAP), contact cards, events, and the EPC, PIX, UPI, Swiss QR-bill and BIP21
  payment codes, tested against vectors from their specifications. The
  inspector names what a code holds and anything unsafe about where it leads,
  and visits nothing.
- Export to SVG, PNG with its physical size written in, PDF in RGB or CMYK,
  EPS, JPEG and WebP, plus print sheets and label sheets. The same design gives
  the same bytes in Node, Chromium, Firefox and WebKit.
- Bulk generation from a CSV file to a ZIP of codes or a PDF of label sheets,
  with templated content and file names, and every row checked.
- `qr-code-studio.html`, the whole studio in one file that sends no request and
  keeps nothing, with its library kept in a file you save.

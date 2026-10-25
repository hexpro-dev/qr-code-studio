# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## Never commit a real person's payload

This repository is public and git history is permanent. A QR code is a
container for exactly the things people do not want published: a Wi-Fi
password, a phone number, a home address on a contact card, an IBAN, a link to
a private document. The inspector in this package exists because those things
are in there.

So, without exception:

- No real payload in any file, test, fixture, issue or pull request. Test
  content is synthetic (`Example Network`, `+61 400 000 000`, `example.com`) or
  is the published example from the specification being tested, cited beside
  it.
- No photograph or screenshot of a real code, including one taken of a test
  sheet this package printed: the photograph carries more than the code.
- No "temporary" commit that is reverted later. The reflog keeps it.

There are no binary fixtures. Every test image is drawn in code by this
package's own renderer, then damaged in code by seeded functions, so the suite
runs on a clean checkout and a wrong expectation shows up in the diff.

Error messages, issues and telemetry never interpolate content. Numbers about
the content (a length, a limit, a row and column in a CSV) are fine; the
content is not. An error message is the one string that gets screenshot into a
bug report.

## What this is

A zero-runtime-dependency package that makes, designs, checks and reads QR
codes entirely in the browser. QR Model 2 (versions 1 to 40), Micro QR and
rectangular Micro QR, behind a symbology interface that other 2D symbologies
can be added to.

It ships three things: a library (several subpaths), browser adapters
(`./dom`), and a single file offline HTML application that runs from
`file://` with the network off. The offline application is a deliverable, not
a demo: it is what makes the privacy claim checkable. apps.hex.pro consumes
`src/` directly through tsconfig `paths` and builds its own React view over
the same headless controller (`./studio`).

`docs/CONTRACTS.md` is the binding description of every public type. Read it
before adding to a layer.

## Commands

```bash
pnpm typecheck        # tsc --noEmit && tsc -p tsconfig.test.json
pnpm lint             # eslint . (privacy bans, determinism zone, layer fences)
pnpm format:check     # prettier --check
pnpm test             # vitest run
pnpm test:coverage    # with per-path thresholds enforced
pnpm build            # tsc -> dist/
pnpm build:html       # single file offline app -> dist/qr-code-studio.html
pnpm build:all        # both
```

## Layers

Each directory under `src/` may import only from the ones listed for it. The
lists live in `eslint.config.js` (`LAYERS`) and are enforced there; this table
is the reasoning.

| Dir          | What it is                                                                                                                                      | May import                                               |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `core/`      | Errors, result, issues, bits, finite fields, Reed-Solomon, BCH, checksums, deflate, zip, seeded PRNG, deterministic maths, the generic registry | nothing                                                  |
| `messages/`  | The English message catalogue the offline app shows                                                                                             | core                                                     |
| `segment/`   | Bitstream profiles, optimal mode segmentation, Shift_JIS safe set, ECI, FNC1, bitstream decode                                                  | core                                                     |
| `symbology/` | QR, Micro QR, rMQR: tables, layout with the role of every module, masks, format and version information, styleable regions by role              | core, segment                                            |
| `encode/`    | Choose symbology, version, error correction and mask; structured append split                                                                   | core, segment, symbology                                 |
| `decode/`    | Reading symbols from pixels and from matrices; the strict profile the scan check uses                                                           | core, segment, symbology                                 |
| `payload/`   | Content types: field schemas, validation, building and parsing the text, the URL safety analyser                                                | core                                                     |
| `geometry/`  | Paths and the neighbour-aware shape builders                                                                                                    | core                                                     |
| `text/`      | TrueType outlines and text layout for frame captions                                                                                            | core, geometry                                           |
| `render/`    | A scene description and its writers: SVG, raster, PNG, PDF, EPS. Knows nothing about QR                                                         | core, geometry                                           |
| `design/`    | The design document, its schema and migrations, the style registries, presets, building a scene                                                 | core, geometry, text, symbology, render, segment, encode |
| `verify/`    | The scan check                                                                                                                                  | everything below it                                      |
| `inspect/`   | What a scanned code says and whether to trust it                                                                                                | core, segment, symbology, decode, payload                |
| `batch/`     | CSV in, ZIP or a label sheet out                                                                                                                | everything below it except decode and inspect            |
| `own-link/`  | Redirect rules and UTM links for people who want to change a destination later                                                                  | core                                                     |
| `studio/`    | The headless controller both user interfaces render                                                                                             | everything above except dom and app                      |
| `dom/`       | Browser adapters with injected dependencies; `dom/library/` is the only storage code                                                            | core, decode, render, studio, symbology, segment         |
| `app/`       | The offline user interface                                                                                                                      | anything except `dom/library`                            |

## Rules that are not obvious from the code

- **Zero runtime dependencies.** `"dependencies": {}` is written out explicitly
  so an accidental addition shows up in a diff, and CI and a test assert the
  count is zero. devDependencies are fine and are used heavily as oracles.
- **Pure parsers throw; attempt-shaped operations return `Result`.** Caller
  mistakes throw `TypeError`. Validation problems are `Issue` values, all of
  them at once, never the first one thrown.
- **No sentences from the library.** Labels, issues and findings are message
  keys plus parameters. `src/messages/en.ts` is the offline app's catalogue;
  the website keeps its own in seven languages and a test there fails on a key
  it does not know. Error classes still carry a plain English `message` for
  developers and the offline app, written in the house register.
- **The determinism zone.** `core`, `segment`, `symbology`, `encode`, `decode`,
  `geometry`, `text`, `render`, `design` and `verify` must give the same answer
  in Node and in every browser engine, because the scan check's verdict and the
  bytes of every export depend on it. ESLint bans `Math.sin`, `cos`, `atan2`,
  `exp`, `pow`, `hypot`, `random` and the other transcendental members, the
  `**` operator, `Date`, `performance`, `Intl`, `toLocaleString` and
  `localeCompare` there. `core/math.ts` provides what is needed from `+ - * /`
  and `Math.sqrt`, which IEEE 754 fixes exactly. Randomness comes from
  `core/prng.ts` with an explicit seed; time is a parameter.
- **Our own deflate.** `CompressionStream` output differs between Node's,
  Chromium's and Apple's zlib, so the same design would give a different PNG
  in each. `core/deflate.ts` is synchronous and deterministic, and zlib is its
  test oracle.
- **No registration at import.** `sideEffects: false` lets a bundler drop an
  import whose only purpose was its side effect, so nothing appends to a
  module-level list. `createRegistries()` returns instances filled with the
  built-ins. A verify job names the registry entries it requires, so a worker
  missing one refuses clearly rather than drawing squares.
- **No top-level DOM or Node access outside `src/dom/` and `src/app/`.** hex-web
  bundles this package into a server-side render. `tests/build/ssr-import.test.ts`
  imports every subpath with the browser globals replaced by getters that throw.
- **No Web Worker in this package.** Chrome blocks blob workers under
  `file://`. Long work is a generator the caller drives in time slices; the
  website wraps the same generator in a module worker of its own.
- **Storage is one file.** `src/dom/library/indexeddb.ts` may use `indexedDB`
  and nothing else may use any store. It is exported as `./dom/library`, used by
  the website only, does nothing at import, and never creates a database until
  the person switches the library on. The offline file stores nothing, and a
  build test fails if the library's source reaches it.
- **SVG output is ours.** Colours go through the allow-list in
  `render/colour.ts`, all text is escaped, gradient ids are deterministic. A
  person's SVG is never passed through into an export.
- **Payload constraints win over design.** A content type can fix the error
  correction level, the size, the colours or the whole design (the Swiss
  QR-bill fixes all four). The studio enforces them; a design never overrides
  them.
- **Micro QR and rMQR are not read by most phone cameras.** Say so wherever one
  is offered, and never call one phone-scannable.

## Testing

- Vitest on Node. v8 coverage with per-path thresholds set just under what the
  suite reaches; raise them when coverage rises.
- Oracles are devDependencies: independent encoders for bit-exact matrices,
  independent decoders for everything this package renders, zlib for deflate,
  `pngjs` for PNG. Comparing this package only against itself proves nothing.
- Spec vectors are cited beside the test that uses them.
- `tests/fuzz/` holds the contract every parser of untrusted input meets: only
  `QrStudioError` escapes, nothing is left unhandled, every call finishes.
- `tests/build/` holds the offline file's integrity, privacy and size tests and
  the SSR import test.

## Style

Tabs. Single quotes. Named exports, no default exports. `.js` extensions on
relative imports (NodeNext). Explicit `import type`. Comments explain why, not
what. Australian English in prose and in identifiers (`colour`, `centre`,
`licence` as a noun). No em dashes or en dashes as prose punctuation, no
curly quotes, no decorative emoji, and none of the marketing register
(unlock, seamless, robust, empower, effortless, leverage); the offline file's
build test enforces this over every string it ships.

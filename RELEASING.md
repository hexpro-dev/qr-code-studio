# Releasing

## Before tagging

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build:all
pnpm test:e2e
pnpm pack --dry-run
```

`pnpm test:e2e` runs the Playwright suites in Chromium, Firefox and WebKit,
one engine at a time. The `app-*` suites open the built offline file from a
`file://` URL with its real security policy, so they are the closest thing CI
has to a person double-clicking the download.

## The checks a machine cannot do

CI proves the code compiles, passes its tests, carries no runtime dependency,
sends no request and stores nothing. It cannot prove a phone scans what the
file prints, because there is no phone in CI and no photograph of a code in
this repository, and there never will be. So before a release, outside version
control and with synthetic content only (`Example Network`, `example.com`,
`+61 400 000 000`):

1. Open `dist/qr-code-studio.html` from your own disc, with the network off, in
   Chrome, Firefox and Safari. Every part has to work: Create, Scan, Bulk, the
   library, saving in every format, printing.
2. Make a web link with the standard design and with three presets from
   different categories (a dots one, a fluid one, one with a logo). Scan each
   from the screen with an iPhone's camera and an Android phone's camera. Both
   must open the link at the first attempt.
3. Save a PDF at 25 mm, print it on plain paper at 100%, and measure it with a
   ruler. It must be 25 mm. Scan the print with both phones.
4. Make a Wi-Fi code for a test network called `Example Network`, and join it
   from both phones by scanning.
5. Choose Micro QR under Encoding. The note that most phones cannot read it
   must show, beside the choice and nowhere called phone-scannable.
6. Save a design and a brand kit to the library, save the library file, close
   the tab, open the file again in a new tab, and use both. What you typed in
   the new tab must not change. Open the library file in a text editor and
   check it holds no content.
7. Run Bulk with a five row CSV to a ZIP and to an A4 label sheet. Print the
   sheet on plain paper and hold it against the label stock.
8. In Scan, start the camera in each browser. Where the browser refuses the
   camera to a file opened from disk, the page must say so in a sentence and
   offer the picture instead; where it allows it, the camera light must go off
   when you stop it, switch mode or hide the tab.
9. Turn on the dark theme, more contrast and reduced motion in the system
   settings, and look at the page again. Turn on VoiceOver or NVDA and make a
   code and save it without the mouse.
10. Check the file's size and digest in the build output against what CI
    printed for the same commit.

## Tagging

1. Bump `version` in `package.json`.
2. Write the entry in `CHANGELOG.md`.
3. Commit both.
4. Tag from `main`:

```bash
git tag -a v1.0.0 -m "1.0.0

<one paragraph on what changed>"
git push origin main --tags
```

The publish workflow (`.github/workflows/publish-npm.yml`) runs on a tag
matching `v*.*.*`. It re-runs the whole gate, because a tag ref does not match
the branch filter that `ci.yml` uses, checks that the tag and `package.json`
agree, publishes, and attaches the offline build to the GitHub release with a
`SHA256SUMS` file beside it.

## Publishing

`npm publish --provenance` against npm's trusted publishing, using the OIDC
token GitHub Actions issues. There is no `NPM_TOKEN` anywhere and there should
never be one.

The trusted publisher is configured on the package at npmjs.com and names this
repository and this workflow filename. Renaming the workflow file or moving the
repository invalidates it, and that is the intended behaviour. Job names are not
part of that configuration.

npm only accepts a trusted publisher on a package that already exists, so 0.1.0
was published by hand (`npm publish --access public`, which runs
`prepublishOnly`) before its tag was pushed. The workflow checks the registry
first and skips the publish when the version is already there, so that tag
still produced the GitHub release, its `SHA256SUMS` and the attestation. Every
later version goes through the workflow alone.

`npm` is installed explicitly in that job because trusted publishing needs npm
11.5.1 or later and Node 22 ships with 10.

The workflow is two jobs. `publish` can read the repository and mint the OIDC
token. `release` can write to the repository and has neither the token nor a
checkout: the offline build reaches it as a workflow artifact. The release is
written by a third party action, and this is how that action ends up in the job
that holds nothing worth taking. Every `uses:` in both workflows names a commit
sha rather than a tag, because a tag is a pointer its owner can move, and
`.github/dependabot.yml` opens a weekly pull request to move the pins forward.

## What a downloader can check

Every release carries two files: `qr-code-studio.html` and `SHA256SUMS`. The
second is one line in the format `sha256sum -c` reads. Put both in the same
directory and:

```bash
sha256sum -c SHA256SUMS
```

The same digest and the byte count are also in the release notes, so they
survive somewhere a person reads rather than only in a file they have to
download.

Neither of those is proof on its own, because anybody with write access here can
replace a release asset and edit the notes. The attestation is the part that
does not rest on trusting this repository. GitHub signs it against the workflow
run and the commit that produced the file:

```bash
gh attestation verify qr-code-studio.html --repo hexpro-dev/qr-code-studio
```

Then the file can be read. Its first lines carry a Content-Security-Policy that
names the sha256 of its one script and its one stylesheet and refuses every
connection (`default-src 'none'`, `connect-src 'none'`), so anything added to
the file after it was built does not run, and nothing in it can reach a
network.

### Rebuilding the offline app

The build is deterministic, so a third party can produce the artefact and check
the digest themselves. `scripts/build-html.ts` reads the source, the stylesheet
and the template, bundles with esbuild, and stamps the version from
`package.json` into the bundle. Nothing else goes in: no timestamp, no build
path, no set whose order depends on the machine. The case named "builds the same
bytes twice" in `tests/build/standalone-html.test.ts` holds it to that by
building twice in one run and comparing the document and both digests, so a
change that reached for the clock fails the suite rather than the release.

From a clean directory:

```bash
git clone https://github.com/hexpro-dev/qr-code-studio
cd qr-code-studio
git checkout v1.0.0
pnpm install --frozen-lockfile
pnpm run build:all
```

`build:html` prints the path, the byte count and the sha256 of what it wrote, so
there is nothing to dig out of a log. Against the release:

```bash
curl -LO https://github.com/hexpro-dev/qr-code-studio/releases/download/v1.0.0/SHA256SUMS
(cd dist && sha256sum -c ../SHA256SUMS)
```

Two things a rebuild gets wrong. `--frozen-lockfile` is not optional: esbuild's
output changes between esbuild versions, and a rebuild that resolved a newer one
produces a different file and proves nothing. And the tag has to be checked out
rather than `main`, because the version string is compiled into the bundle.
Nothing in the build reads the Node version, but the release runs on Node 22, so
match it before assuming a mismatch means something worse.

## The size of the file

`tests/build/standalone-html.test.ts` holds the whole document between 150 kB
and 800 kB, and `tests/build/budget.test.ts` holds each area of the package
(the studio, the design layer, the messages, the fonts and the rest) to its own
share of the program. When a budget fails, read what grew before raising it:
the failure it exists to catch looks exactly like a feature until you look.

## Never in a release

A real payload or a photograph of a real code, in the package, in a fixture, in
the changelog, or in a screenshot attached to the release. That includes a
photograph of a test sheet this package printed: the photograph carries more
than the code. See the top of `CLAUDE.md`.

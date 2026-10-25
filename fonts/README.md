# Built-in fonts

The source files for the caption fonts compiled into `src/fonts/latin.ts`.
Nothing in this directory ships: `scripts/build-fonts.ts` reads these files
and writes the compiled tables, and `pnpm build:fonts` runs it.

## Source

IBM Plex Sans, Regular and Bold, from the `@ibm/plex-sans` 1.1.0 release of
the official repository (font version 3.005):

- Release: https://github.com/IBM/plex/releases/tag/%40ibm%2Fplex-sans%401.1.0
- Archive: https://github.com/IBM/plex/releases/download/%40ibm/plex-sans%401.1.0/ibm-plex-sans.zip
  (SHA-256 `fb365d910566e6d199cc2c15579a7dd9a267128e18431a394ed81f1970c69200`)

The files here are copied from that archive unchanged:

| File                      | Path in the archive                                        | SHA-256                                                            |
| ------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `IBMPlexSans-Regular.ttf` | `ibm-plex-sans/fonts/complete/ttf/IBMPlexSans-Regular.ttf` | `975dcda37d80f038dcd143c22e33ca2d97a0cc5a929aace1c749153b0fe1afa5` |
| `IBMPlexSans-Bold.ttf`    | `ibm-plex-sans/fonts/complete/ttf/IBMPlexSans-Bold.ttf`    | `9e6c74a889a700d707613d24548fe4ffa6bc59559a0689d2cf9e133bdcdafb2f` |
| `OFL.txt`                 | `ibm-plex-sans/LICENSE.txt`                                | `7e6b2818edbd8f6a01ae80641cc8f16a51080d08fb4e532be3a0b6f74adb07da` |

The build refuses to run on a file whose SHA-256 differs, and
`tests/text/build-fonts.test.ts` checks this table against the files and the
script.

Both are TrueType (`glyf`) outlines at 1000 units to the em, with kerning in
GPOS (three pair adjustment lookups, which a shaper adds together).

## Subset

| Weight  | Unicode blocks                                                                                             |
| ------- | ---------------------------------------------------------------------------------------------------------- |
| Regular | Basic Latin (U+0020 to U+007E), Latin-1 Supplement (U+00A0 to U+00FF), Latin Extended-A (U+0100 to U+017F) |
| Bold    | The same, Greek and Coptic (U+0370 to U+03FF), Cyrillic (U+0400 to U+04FF)                                 |

Every code point in those ranges that the font maps is kept. Both weights
also carry 25 characters people type into captions without meaning to:
typographic quotes and dashes, the ellipsis, the bullet, the narrow no-break
space, four arrows, the numero and trade mark signs, and the euro, hryvnia,
rupee, lira, rouble and bitcoin signs. `EXTRAS` in the build script lists
them.

Greek and Cyrillic are in Bold only because of size. With them in both
weights the compiled tables came to more than 70 kB in a minified bundle,
against a budget of 60 kB, so they were dropped from Regular first. The two
tables as built are 56.1 kB minified.

## Licence

IBM Plex is licensed under the SIL Open Font License 1.1, with the Reserved
Font Name "Plex". `OFL.txt` is the licence as IBM ships it.

The compiled subset is a Modified Version under that licence (it is cut down
and converted to another format), so it is never presented to people under
the Reserved Font Name: its labels in `src/messages/en/text.ts` are "Sans"
and "Sans bold". The ids `plex-sans-regular` and `plex-sans-bold` are
identifiers in design files, not font names shown to anyone.

The licence travels with the compiled tables in two forms: the generated
module's header comment carries it in full (which `tsc` keeps in `dist/`),
and it is exported as `FONT_LICENCE` so a page that bundles the tables, where
comments are stripped, can show it.

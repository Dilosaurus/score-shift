# tools/chart — one PDF in, one catalog chart out

This is the pipeline a person (or their Claude Code session) uses to transcribe a chart from a
scanned PDF and publish it to the ScoreShift catalog. It is separate from the Real Book /
Colorado Cookbook queue that runs on Chris's computer; both publish into the same live site
without ever writing each other's files.

Nothing here recognizes music from pixels. **The reader of the scan is you.** The tools render
pages and crops so you can look, turn what you wrote into MusicXML, prove it holds together,
engrave it the way the app will, and publish it.

## The workflow

```
python tools/chart/chart.py new "C:\path\Blue Bossa.pdf" --book dads-charts --book-title "Dad's charts" --title "Blue Bossa" --composer "Kenny Dorham"
python tools/chart/chart.py systems dads-charts-blue-bossa --page 1 --count 8     # strips, one per staff system
python tools/chart/chart.py crop dads-charts-blue-bossa --page 1 --box 0.05,0.20,0.95,0.34   # any region, enlarged
#   ... read the scan, write charts/dads-charts/dads-charts-blue-bossa/chart.json ...
python tools/chart/chart.py check dads-charts-blue-bossa       # build + schema + timing + ties + transposition + engraving
#   ... compare renders/key-0-page-1.png (and the other keys) against the scan, fix, re-check ...
python tools/chart/chart.py approve dads-charts-blue-bossa     # only after review.source_checked is true
python tools/chart/chart.py publish                            # every approved chart, to the live catalog
python tools/chart/chart.py status
```

`new` registers the book the first time (`books/<book>.json`), extracts the pages you name into
`source.pdf` (pixels verified identical), renders `source/page-N.png` at 300 dpi, and writes an
empty `chart.json` plus `notes.md`. `check` rebuilds the MusicXML every time, so `build` is only
needed when you want the files without the checks.

`publish` needs a Google login with access to the Firebase project (`gcloud auth login`, see
`docs/DAD_SETUP.md`). It writes only `/catalog/books.json`, `/catalog/<book>.json` and
`/samples/<book>/<id>.mxl|.pdf`, merges them into the current live release, refuses to touch
anything else, aborts if the live site changes mid-publish, and verifies the served bytes.
`--dry-run` lists what would change; `--verify-only` checks what is live against what is approved.

## chart.json

```json
{
  "id": "dads-charts-blue-bossa", "book": "dads-charts",
  "title": "Blue Bossa", "composer": "Kenny Dorham",
  "source": { "...written by new..." },
  "divisions": 12, "key": -3, "mode": "minor", "time": "4/4", "clef": "G",
  "tempo": 160, "feel": "Bossa",
  "measures": [
    { "section": "A", "system": true, "repeat": "start", "notes": "r:q G4:q C5:q D5:q", "chords": ["Cm7"] },
    { "notes": "Eb5:h. ...", "chords": ["Fm7"] },
    { "ending": "1", "notes": "...", "chords": ["Dm7b5", "G7b9@3"] },
    { "repeat": "end", "notes": "...", "chords": ["Cm7"] },
    { "ending": "2", "final": true, "notes": "C5:w:fer", "chords": ["Cm7"] }
  ],
  "review": { "source_checked": false, "unresolved": [] }
}
```

Top level: `key` is fifths (-7…7: -3 = three flats), `mode` optional, `time` like `"3/4"`, `clef`
`G` or `F`, `divisions` per quarter note (12 handles eighths, sixteenths, dotted values and
triplet eighths, quarters and sixteenths; use 24 for 32nd notes), `tempo` in quarter beats per minute, `feel` is the
text printed above bar 1 ("Medium swing"), `part` renames the staff (default "Melody").

### Notes (`notes`, and optionally `voice2`)

One token per event, separated by spaces: `PITCH:RHYTHM[:flag...]`

| Piece | Values |
|---|---|
| PITCH | `C4` middle C, `Bb3`, `F#5`, `Cb5`, `B#3`. `r` = rest. `x` = rhythm slash (transposition leaves it alone). |
| RHYTHM | `w` whole · `h` half · `q` quarter · `e` eighth · `s` sixteenth · `d` prefix = dotted (`dq`, `de`, `dh`) · `dd` = double dotted · `t` suffix = triplet, three in the time of two (`et`, `qt`, `st`) · `g` = grace note (no duration) |
| flags | `>` tie starts here · `<` tie ends here · `<>` both · `acc` the scan prints an accidental on this note · `cacc` cautionary accidental in parentheses · `fer` fermata · `stacc` · `acc>` accent · `ten` tenuto |

A bar must add up to its time signature or the encoder refuses it and tells you the bar and the
totals. A pickup bar sets `"pickup": true` and may be shorter; a final short bar after a pickup
sets `"short": true`. A whole-bar rest is `r:w` (or `r:dh` in 3/4).

Pitches are written as they SOUND in the current key: an F sharp in the key of G is `F#4` even
though the scan prints no sharp. `acc` only records that the scan printed the sign.

### Chords (`chords`)

Strings of `Symbol@beat`; beat is one-based and may be fractional (`2.5` = the "and" of two);
`@1` may be omitted. `N.C.` for no chord, `/` for a printed repeat slash. Slash basses are
`Bb/D`. Recognised qualities include `m`, `-`, `7`, `maj7`, `Δ`, `m7`, `-7`, `m(maj7)`, `dim`, `o`,
`dim7`, `m7b5`, `ø`, `aug`, `+`, `6`, `m6`, `69`, `9`, `maj9`, `m9`, `11`, `13`, `sus`, `sus4`,
`7sus4`, `add9`, `alt`, and any of those followed by alterations such as `b9`, `#9`, `#11`, `b13`,
`#5`, `b5`, `add9`. The label prints exactly as you typed it; the semantic root/bass is what
transposes. An unknown quality stops the build with its name so you can add it to `KINDS`.

### Measure fields

| Field | Meaning |
|---|---|
| `system: true` | this bar starts a new printed staff system. **Put one on every system start** so the engraving matches the scan. `page: true` for a page break. |
| `section: "A"` | rehearsal letter |
| `repeat: "start" / "end" / "both"` | repeat barlines |
| `ending: "1"` / `"2"` / `"1,2"` | an ending bracket starts here; it closes at the repeat end, a `double`/`final` bar, `ending_stop: true`, the bar before the next ending, or the last bar |
| `double: true` / `final: true` / `double_left: true` | barline styles |
| `segno: true`, `coda: true`, `to_coda: true`, `ds: "D.S. al Coda"`, `dc: "D.C. al Fine"`, `fine: true` | navigation marks and their playback semantics |
| `key: 1`, `mode: "major"`, `time: "3/4"`, `clef: "F"` | changes taking effect at this bar |
| `words: "Solo break"` | text above the bar; `text: [{"text": "…", "beat": 3, "below": true}]` for placed text |
| `lyrics: ["Porch|light|on"]` | one entry per verse, `|`-separated, one syllable per event (rests get an empty slot); trailing `-` = hyphenated into the next syllable; `_` = the previous syllable continues (melisma) |
| `slurs: [[0, 2]]` | pairs of event indexes (zero-based) |
| `beams: [[0, 1], [2, 3]]` | override the automatic beaming |
| `voice2: "B4:h r:h"` | a second voice below, same grammar, must total the same length |
| `pickup: true`, `short: true` | bars allowed to be shorter than the time signature |

### Review block

`check` never sets `review.source_checked`. You set it to `true` in chart.json only after you
have compared every rendered page (`renders/key-0-page-N.png`, plus the -2 and +1 keys) against
the scan, system by system. Anything you could not read with confidence goes in
`review.unresolved` as a sentence; `approve` refuses while that list has entries, so ask the
person who owns the chart, or write the most defensible reading and note it in `notes.md`, then
clear the entry.

## What the checks prove

- **schema**: MusicXML 4.0 (W3C schema, offline copy under `schema/`).
- **timing**: every voice in every bar fills exactly the bar; chord offsets fall inside their bar.
- **ties**: every tie start finds its stop on the next note of the same pitch.
- **transposition**: at -2, 0 and +1 semitones every note, chord root and slash bass moves by
  exactly that amount and nothing else changes (durations, types, lyrics, chord labels, counts).
- **layout**: the reader's own engraving pipeline (`dist/layout.mjs` line-break fitting) puts the
  chart on no more pages than the scan had, in every checked key. Renders are written for you to look at.

The PNG renders show a triangle where a chord name has a flat and boxes for the metronome note
because the notation font is not installed for the local rasterizer; the live app renders those
correctly. Read them as flats.

## Layout on disk

```
books/<book>.json                       registry: title + chart list with status/revision/published_revision
charts/<book>/<id>/source.pdf           the pages you transcribed (only these pages)
charts/<book>/<id>/source/page-N.png    300 dpi page images (not committed)
charts/<book>/<id>/source/systems/…     strips from `systems` (not committed)
charts/<book>/<id>/source/crops/…       enlargements from `crop` (not committed)
charts/<book>/<id>/chart.json           what you read, in the grammar above
charts/<book>/<id>/notes.md             source map, tricky readings, verification notes
charts/<book>/<id>/<id>.musicxml|.mxl   built by check/build
charts/<book>/<id>/verification.json    the last check's report (hash-pinned to chart.json and the MXL)
charts/<book>/<id>/renders/…            review pages (not committed)
charts/<book>/<id>/approval.json        written by approve; publish refuses if any artifact drifts from it
charts/.publish/<stamp>.json            publish receipts (not committed)
```

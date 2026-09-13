---
name: transcribe-chart
description: Transcribe a scanned lead sheet (PDF) into the ScoreShift catalog by reading it visually and encoding it with tools/chart. Use when someone says "transcribe this PDF", "add this chart to the catalog", "put this song in ScoreShift", or hands over a PDF of sheet music.
---

# Transcribe a chart into ScoreShift

You read the scan. The tools render it, encode what you wrote, check it, engrave it, and publish
it. Read `tools/chart/README.md` (the `chart.json` grammar) once per session before you start.

## 0. Ask for what is missing, then start the chart

You need: the PDF path, which pages hold this song (a book PDF has many), the title, the
composer if printed, and the book id. The first time, agree on a book id with the person
(`dads-charts` is a fine default; a printed collection gets its own, e.g. `jazz-standards-vol-2`).

```
python tools/chart/chart.py new "<pdf>" --book <book> [--book-title "..."] --title "<Title>" --composer "<Composer>" --pages 3-4
```

Note the chart id it prints (`<book>-<title-slug>`) and the folder `charts/<book>/<id>/`.

## 1. Look at the whole page first

Open `charts/<book>/<id>/source/page-1.png` (Read the image). Establish clef, key signature,
time signature, tempo/feel words, how many staff systems the page has, where the repeats, endings,
segno, coda, D.S./D.C. marks sit, and whether there are lyrics or a second voice.

Cut the page into system strips and read those; enlarge anything unclear:

```
python tools/chart/chart.py systems <id> --page 1 --count <systems on the page>
python tools/chart/chart.py crop <id> --page 1 --box x0,y0,x1,y1      # fractions of the page, e.g. 0.05,0.30,0.95,0.44
```

Write the source map into `notes.md` as you go: page → system → written measure numbers,
including the pickup, endings, solo sections and codas. This is how you prove you covered
every bar.

## 2. Read a few bars at a time, in passes

For each system: confirm the active clef/key/time, then

- **Pitches and rhythms.** Letter, accidental, octave from the staff position and the key
  signature. Write the SOUNDING pitch (`F#4` in G major even with no printed sharp); add `acc`
  when the scan prints an accidental, `cacc` when it is in parentheses. Reassess accidental
  state at every barline. Ties (`>` `<`) are between equal pitches; slurs are curves over
  different pitches and go in `slurs`.
- **Chords.** The beat each symbol sits over, root spelling as printed, quality exactly as
  printed, slash bass. `N.C.` and repeat slashes count.
- **Lyrics, directions, form.** Syllables under the notes, verse numbers, rehearsal letters,
  repeat signs, ending numbers, "To Coda", D.S./D.C., Fine, fermatas.

Passages that look repeated are read from their own crops; lead sheets vary rhythms and
lyrics between similar refrains. A bar that adds up can still be wrong.

Put one measure object per written bar into `chart.json` `measures`, with `"system": true` on
the first bar of every printed system. Count written bars; never expand repeats.

## 3. Check, look, fix, repeat

```
python tools/chart/chart.py check <id>
```

A failure names the bar and what is wrong (a bar that does not add up, a tie with no partner, an
unknown chord quality, a chart that needs more pages than the scan). Fix `chart.json`, not the
generated XML.

When it passes, Read every file under `charts/<book>/<id>/renders/` and compare each system
against the scan crops: pitches, octaves, accidentals, rhythm grouping, ties, chord names and
positions, lyrics, endings, navigation, and that the systems break where the scan breaks. Do
the same for the `key--2` and `key-1` renders (they must be the same music a step away; flats
in chord names appear as triangles in these PNGs, read them as flats). Fix and re-check until
the pages match.

Record in `notes.md`: what you verified, and any reading you had to decide on. Anything you
could not read with confidence goes in `review.unresolved` and you show the person the crop and
ask. Only when the list is empty and you have compared every page, set
`"review": {"source_checked": true, "unresolved": []}`.

## 4. Approve and publish

```
python tools/chart/chart.py approve <id>
python tools/chart/chart.py publish --dry-run     # first time, show the person what will change
python tools/chart/chart.py publish
```

`publish` needs the machine's Google login (`gcloud auth login`, see `docs/DAD_SETUP.md`). If it
says the live site changed mid-publish, just run it again. It ends by fetching the published
files back and comparing bytes; report that result. The chart appears in the app under
Catalog → the book's chip within a minute (reload the app).

Then, if this folder is a git repository (`git status` works), commit the work by name:

```
git add charts/<book>/<id> books/<book>.json
git commit -m "Transcribe <Title> into <book>"
git push        # only when a remote is configured; skip silently otherwise
```

If it is not a git repository (the project came as a zip), skip this step; the chart is safe in
`charts/<book>/<id>/` and on the live site.

## 5. Tell the person what you did

Title, book, number of bars, what the checks proved, which pages you compared, anything you
decided under uncertainty and where it is noted, and the live URL. Say plainly if anything
could not be verified.

## Never

- Use OCR, Audiveris, a remembered arrangement or an online score as the source.
- Invent a note, chord, lyric or repeat to make a bar add up.
- Set `source_checked` without having looked at every render.
- Run `deploy-hosting.py`, anything under `output/`, or `git add -A`.

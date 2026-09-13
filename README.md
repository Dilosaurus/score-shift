# ScoreShift

Sheet-music workspace with faithful multipage PDF import, local optical music recognition, MusicXML transposition, original/score comparison, correction tools, and PDF/MusicXML export.

## Complete visual transcription

For another PDF, follow [Transcribing a PDF into ScoreShift without OCR](docs/VISUAL_TRANSCRIPTION.md). It includes a copyable prompt for another assistant, the measure-by-measure authoring method, validation and visual review steps, and the limits of the Golden Lady example script. This is an assistant-assisted workflow; it is separate from the app's Audiveris recognition action.

Choose **Open full transcription**, or open http://127.0.0.1:5173/?score=golden-lady-full. Both supplied PDF pages have been transcribed visually into 51 written measures, with melody, 64 chord symbols, lyrics, repeats, endings, and modulations. This score was authored directly from the scan, independently of the optional OCR workflow below.

The editable file is `output/golden-lady-full.musicxml`; the source map and editorial details are in `output/golden-lady-transcription-notes.md`. **Compare** displays the original PDF alongside the complete score. Two one-note tie fragments at the D.S./Coda jump are encoded in MusicXML but omitted by the current engraver. `transcribe_golden_lady.py` contains the measure-by-measure transcription data and regenerates the output files.

## Real Book transcription tests

The three songs beginning on PDF page 10 are available in **Library**: [Afro Blue](http://127.0.0.1:5173/?score=afro-blue), [Afternoon in Paris](http://127.0.0.1:5173/?score=afternoon-in-paris), and [Airegin](http://127.0.0.1:5173/?score=airegin). Each includes transposable melody/chords and its original source page for Compare. Portable MXL/MusicXML files, source maps, the visual authoring script, and checks are in [the transcription report](output/real-book-tests/transcription-notes.md).

These authored scores include layout metadata to retain their encoded staff/page breaks in the reader. Afro Blue uses two notation pages; the other two use one each. The transposer now writes the accidentals required in the new key, so chromatic notes remain visibly correct when engraved.

## Hosted copy

The reader is published on Firebase Hosting at https://scoreshift-reader.web.app (Firebase project `scoreshift-reader`, its own project, separate from Apex, on the free plan). Everything in `dist/` runs in the browser: PDF viewing, MusicXML import, transposition, comparison, correction tools, and export.

Music recognition is the one thing the hosted copy cannot do on its own: it still calls the local server on this Windows computer. If ScoreShift is running here (`Start ScoreShift.ps1`), the hosted page can use it from this same computer; on any other device, import MusicXML instead. Running Audiveris in the cloud (Cloud Run) would need billing enabled on the project.

Redeploy after changing `dist/` or `firestore.rules`:

    python deploy-hosting.py           # site + rules
    python deploy-hosting.py --rules   # rules only

The script uses the local `gcloud` login (no `firebase login` needed) and reads `firebase.json` + `.firebaserc`.

## Online library, Books, and Sets

Every device gets an online library the first time it opens ScoreShift, and keeps a local copy of everything in IndexedDB so the reader works offline once synced. **Library › Sharing › Share invite link** hands the library to another device: opening the link (or pasting it under "Join a different library") joins that library and merges the device's own charts, books, and sets into it. Anyone with the link sees the same charts, keys, and corrections, live. Removing a chart removes it for everyone.

**Books** are named collections a chart can belong to (All charts is always present); membership is toggled from Score options. **Sets** are ordered gig lists; each entry can carry its own key, which applies only while that set is playing. **Play set** walks song to song with the page arrows and shows a set bar with the position.

The library lives in Firestore (`libraries/{code}/scores/{id}` for charts, `libraries/{code}/lists/{id}` for books and sets), with the PDF bytes and MusicXML stored beside each chart as chunked documents (`blobs/{field}.{index}`, 700 KB per chunk, SHA-256 verified on download). The invite code is the credential: 26 random characters (130 bits), never listable, enforced by `firestore.rules`. There are no accounts; keep the link private.

`dist/songbook.mjs` holds the sync logic (pure helpers are unit-tested in `tests/songbook.test.mjs`); `dist/firebase-config.mjs` carries the public Firebase client config. The Firebase SDK loads from `www.gstatic.com` only after a songbook is started or joined.

## Open the app

Run `Start ScoreShift.ps1`, then open http://127.0.0.1:5173. Node.js must be installed. The app and recognition engine have been prepared on this computer. The server listens only on loopback and does not start with Windows.

The reader opens directly on the score. **Library** opens a searchable drawer; the **key button** opens transposition. **Score options** contains Original PDF / Score / Compare, fit width / fit page, focus mode, and correction tools. Bottom arrows (or keyboard left/right arrows) turn pages; +/− change zoom. Export prints every notation page, even though the reader shows one page at a time.

Golden Lady now uses a standard letter page with six fixed staff rows per page, Bravura music glyphs, and Arial text. Changing key preserves page dimensions, staff size, and system positions; horizontal spacing inside measures can adjust to accommodate accidentals. MusicXML exports include the page and font settings. Other notation applications may apply their own engraving rules when opening MusicXML.

The interface can be hosted as static files for viewing PDFs and transposing MusicXML; this revision is being used locally. Recognizing a new PDF requires this computer's local server to be running. Recognition is not hosted in the cloud.

## Workflow

1. Import or drag a PDF, MusicXML, or compressed MXL score into the app. Scores are saved in this browser's IndexedDB on this device. Clearing site storage removes those local copies.
2. PDFs display every page, preserving rotation, aspect ratio, and the original file bytes. PDFs do not contain editable musical pitches.
3. For a PDF, choose **Recognize music**. Audiveris produces a draft, which may split into multiple movements; each is retained in My scores. Alternatively import matching MusicXML from a notation application.
4. Compare the original and editable score. **Review notes & chords** supports pitch corrections, initial key correction, and the full MusicXML editor for rhythm, missing notes, and chord edits. Advanced XML edits take precedence over the simple fields.
5. Select a key or an interval from -24 to +24 semitones. Notes, chord roots, slash bass notes, and key signatures change together. Rhythm values, lyrics, ties, and other notation are preserved from the editable source. The original PDF never changes.
6. Check the review acknowledgment for recognized scans. Export MusicXML or print the engraved score using **Save as PDF**. This acknowledgment is a user review state, not automated verification of the transcription.

## Approved charts publish to the library and hosted app

`tools/publish-charts.mjs` uploads ready charts from the registered book manifests and generated `dist/transcriptions.mjs` catalog into the shared library configured in `library.local.json` (gitignored; `{"library":"<invite code>"}`). It runs automatically after `coordinate.py approve` / `refresh` and after `python deploy-hosting.py`; `npm run publish:charts` runs it by hand. `--dry-run` plans changes without writes; `--verify-only` reads actual remote PDF/XML chunks and compares their hashes and sizes to the approved local files. Identical contents are left alone, user-edited copies are preserved, and differing copies at equal/newer revisions are reported as conflicts. Uploads use a transaction and verify the contents afterward. Library copies use the same `visual-<id>` IDs as the app. Other books use catalog `assetBase` paths, and drafts are excluded. The destination code is never logged. Set `SCORESHIFT_NO_PUBLISH=1` to keep coordinator maintenance local.

The same `approve` / `refresh` command then runs `tools/publish-hosted-charts.py` to publish the approved MXLs, paired source PDFs, catalog and book progress to Firebase Hosting. It preserves the live app's other files and configuration, checks that approval inputs and the live release have not changed, and verifies the published bytes. It does not deploy local app changes or Firestore rules. `python tools/publish-hosted-charts.py --dry-run` shows the proposed changes; `--verify-only` checks every approved hosted chart and progress file.

Both destinations must succeed before reporting a chart as published. Failures preserve the approved transcription but return a nonzero coordinator exit code. Retry with `python output/real-book-batch/coordinate.py refresh`. Results are recorded in `output/transcription-library/publishing-status.json`, with Hosting release and file-hash receipts under `output/transcription-library/hosting-publish/`. `SCORESHIFT_NO_PUBLISH=1` skips both destinations.

## Page fitting

The reader preserves source courtesy accidentals and adds parenthesized reminders when a pitch returns to the key signature after an alteration in the preceding bar. This applies in the original key, after transposition, and in app exports. See [the courtesy policy](docs/COURTESY_ACCIDENTALS.md) for ties, voices, and review requirements.

A transcribed chart is engraved onto no more pages than its source scan had. `dist/layout.mjs` keeps the encoded line breaks (Verovio "line" mode, which paginates automatically instead of obeying encoded page breaks) and steps the engraving down a ladder of scale, system spacing, and margins until the page count matches the original; the result is cached per chart and key. Dense Real Book pages with nine or ten systems land around scale 36 to 42. `tmp/fit-check.mjs` reports the before/after page count for every approved chart.

## Playback

The play button in the header (or the space bar) plays the chart in its current key: sampled piano for the melody, plus comping piano and bass generated from the chord symbols. The tempo starts at the chart tempo (104 for Golden Lady) and can be dragged from 40 to 240 BPM; a changed tempo is saved with the chart. Melody, chords, bass, and a one-bar count-in can each be switched off. The notes being played are highlighted and pages turn on their own. Repeat signs are played (Verovio expands them); D.S. and coda jumps are not followed yet.

Under the hood: Verovio exports the transposed score as MIDI and a timemap; `dist/playback.mjs` reads the MIDI, walks the MusicXML for chord positions, maps the expanded measures back to written ones, and schedules everything on Web Audio. The piano and bass samples (`dist/vendor/soundfont/`, FluidR3_GM via midi-js-soundfonts, CC-BY 3.0) load the first time playback starts. `tmp/check-playback.mjs` runs the whole pipeline against Golden Lady in Node.

## Accuracy boundary

“Golden Lady chart.pdf” is a two-page raster scan with handwritten notation. Automatic recognition is imperfect: it can miss chords, misread rhythms or keys, and split movements incorrectly. The app preserves the PDF exactly but cannot promise automatic lossless PDF-to-notation conversion. The number of detected chords and notes is shown, and recognized output stays marked as requiring review. A clean MusicXML source is the most reliable transposition input.

Pitch transposition supports standard, partwise MusicXML. It does not rewrite guitar fret numbers, arbitrary chord text embedded in directions, audio, or pixels in a PDF. Nonstandard keys without fifths and microtonal/keyless music require manual review. Pitched harmony elements are transposed; text-only chord annotations are not.

## Recognition setup on another Windows computer

Run `setup-recognition.ps1`. Requires 7-Zip in `C:/Program Files/7-Zip/7z.exe`. It downloads the checksum-pinned Audiveris 5.11.0 Windows console package, extracts its bundled Java runtime without installing an application, and configures the compatible English Tesseract model. Runtime files stay under `.runtime`; the OCR language data is placed in Audiveris's per-user configuration directory. You can override the executable path with `AUDIVERIS_PATH`.

Recognition accepts PDFs up to 50 MB, with a UI limit of 20 pages per recognition job and a ten-minute time limit. PDF viewing supports up to 100 pages. Only one recognition job runs at a time. Diagnostic input and output files are retained in `.runtime/jobs` on this computer; no PDF is sent to an external recognition service.

## Development and verification

`npm ci` restores the exact dependency versions. `npm start` serves the app. `npm test` checks chromatic pitch changes across 49 intervals, harmony/slash-bass shifts, octave boundaries, enharmonic choices, rhythm/lyric/tie preservation, invalid input, and engraving through Verovio. The PDF integration check in `tests/check-import.mjs` uses Node 24 and requires a completed local recognition job referenced in `tmp/test-job-id.txt`.

The authored browser files are in `dist/`; there is no bundler build step. The static deployment excludes the local Node recognition service and `.runtime` binaries. WebMCP registration is feature-detected; browser-level WebMCP validation was unavailable in this run.

## Whole-book transcription

The queue contains 678 chart jobs: 400 from the supplied Real Book across 453 music pages, plus 278 from The Colorado Cookbook (`colcookbk.pdf`) across 272 music pages. The local [book progress page](http://127.0.0.1:5173/real-book.html) has a source-book selector and lists queued, active, review and ready charts. [Open the Colorado queue](http://127.0.0.1:5173/real-book.html?book=colorado-cookbook). Shared pages and separately printed arrangements retain separate jobs; duplicate index aliases are consolidated. Ready titles open with their paired source PDFs. This is a coordinated visual-transcription workflow, not an automatic OCR feature.

The durable queue and continuation process are documented in [ORCHESTRATION.md](output/real-book-batch/ORCHESTRATION.md). [books.json](output/transcription-library/books.json) registers each source and its manifest; each manifest has a generated `PROGRESS.md` alongside it. Run `coordinate.py status --book real-book` or `--book colorado-cookbook` before assigning work. Worker folders are isolated; only the coordinator updates manifests and the combined ready catalog. The same-task hourly continuation is named "Transcribe the Real Book" and now covers both books, pausing after completion. It depends on Codex and the local computer being available. Finished charts publish to both the configured shared library and the Firebase-hosted app as they are approved.

# ScoreShift

Sheet-music workspace with faithful multipage PDF import, local optical music recognition, MusicXML transposition, original/score comparison, correction tools, and PDF/MusicXML export.

## Complete visual transcription

For another PDF, follow [Transcribing a PDF into ScoreShift without OCR](docs/VISUAL_TRANSCRIPTION.md). It includes a copyable prompt for another assistant, the measure-by-measure authoring method, validation and visual review steps, and the limits of the Golden Lady example script. This is an assistant-assisted workflow; it is separate from the app's Audiveris recognition action.

Choose **Open full transcription**, or open http://127.0.0.1:5173/?score=golden-lady-full. Both supplied PDF pages have been transcribed visually into 51 written measures, with melody, 64 chord symbols, lyrics, repeats, endings, and modulations. This score was authored directly from the scan, independently of the optional OCR workflow below.

The editable file is `output/golden-lady-full.musicxml`; the source map and editorial details are in `output/golden-lady-transcription-notes.md`. **Compare** displays the original PDF alongside the complete score. Two one-note tie fragments at the D.S./Coda jump are encoded in MusicXML but omitted by the current engraver. `transcribe_golden_lady.py` contains the measure-by-measure transcription data and regenerates the output files.

## Hosted copy

The reader is published on Firebase Hosting at https://scoreshift-reader.web.app (Firebase project `scoreshift-reader`, its own project, separate from Apex, on the free plan). Everything in `dist/` runs in the browser: PDF viewing, MusicXML import, transposition, comparison, correction tools, and export.

Music recognition is the one thing the hosted copy cannot do on its own: it still calls the local server on this Windows computer. If ScoreShift is running here (`Start ScoreShift.ps1`), the hosted page can use it from this same computer; on any other device, import MusicXML instead. Running Audiveris in the cloud (Cloud Run) would need billing enabled on the project.

Redeploy after changing `dist/` or `firestore.rules`:

    python deploy-hosting.py           # site + rules
    python deploy-hosting.py --rules   # rules only

The script uses the local `gcloud` login (no `firebase login` needed) and reads `firebase.json` + `.firebaserc`.

## Shared songbook

Scores are saved in the browser (IndexedDB) on each device. To keep one library across phones, tablets, and computers, open **Library** and choose **Start a shared songbook**, then **Share invite link**. Anyone who opens the link (or pastes it into **Join**) sees the same scores, keys, and corrections, live. Removing a score removes it for everyone.

The songbook lives in Firestore (`libraries/{code}/scores/{id}`), with the PDF bytes and MusicXML stored beside each score as chunked documents (`blobs/{field}.{index}`, 700 KB per chunk, SHA-256 verified on download). The invite code is the credential: 26 random characters (130 bits), never listable, enforced by `firestore.rules`. There are no accounts; keep the link private. Each device downloads every score in the songbook in the background so the library also works offline once synced.

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

## Accuracy boundary

“Golden Lady chart.pdf” is a two-page raster scan with handwritten notation. Automatic recognition is imperfect: it can miss chords, misread rhythms or keys, and split movements incorrectly. The app preserves the PDF exactly but cannot promise automatic lossless PDF-to-notation conversion. The number of detected chords and notes is shown, and recognized output stays marked as requiring review. A clean MusicXML source is the most reliable transposition input.

Pitch transposition supports standard, partwise MusicXML. It does not rewrite guitar fret numbers, arbitrary chord text embedded in directions, audio, or pixels in a PDF. Nonstandard keys without fifths and microtonal/keyless music require manual review. Pitched harmony elements are transposed; text-only chord annotations are not.

## Recognition setup on another Windows computer

Run `setup-recognition.ps1`. Requires 7-Zip in `C:/Program Files/7-Zip/7z.exe`. It downloads the checksum-pinned Audiveris 5.11.0 Windows console package, extracts its bundled Java runtime without installing an application, and configures the compatible English Tesseract model. Runtime files stay under `.runtime`; the OCR language data is placed in Audiveris's per-user configuration directory. You can override the executable path with `AUDIVERIS_PATH`.

Recognition accepts PDFs up to 50 MB, with a UI limit of 20 pages per recognition job and a ten-minute time limit. PDF viewing supports up to 100 pages. Only one recognition job runs at a time. Diagnostic input and output files are retained in `.runtime/jobs` on this computer; no PDF is sent to an external recognition service.

## Development and verification

`npm ci` restores the exact dependency versions. `npm start` serves the app. `npm test` checks chromatic pitch changes across 49 intervals, harmony/slash-bass shifts, octave boundaries, enharmonic choices, rhythm/lyric/tie preservation, invalid input, and engraving through Verovio. The PDF integration check in `tests/check-import.mjs` uses Node 24 and requires a completed local recognition job referenced in `tmp/test-job-id.txt`.

The authored browser files are in `dist/`; there is no bundler build step. The static deployment excludes the local Node recognition service and `.runtime` binaries. WebMCP registration is feature-detected; browser-level WebMCP validation was unavailable in this run.

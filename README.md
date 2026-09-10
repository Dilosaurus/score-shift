# ScoreShift

Sheet-music workspace with faithful multipage PDF import, local optical music recognition, MusicXML transposition, original/score comparison, correction tools, and PDF/MusicXML export.

## Open the app

Run `Start ScoreShift.ps1`, then open http://127.0.0.1:5173. Node.js must be installed. The app and recognition engine have been prepared on this computer. The server listens only on loopback and does not start with Windows.

The private hosted interface works without a local server for viewing PDFs and transposing MusicXML. Recognizing a new PDF requires this computer's local server to be running; the browser may request local-network access. Recognition is not hosted in the cloud.

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

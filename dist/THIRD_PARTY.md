# Third-party components

- PDF.js 6.3.289 — Apache-2.0 — https://github.com/mozilla/pdf.js
- Verovio 6.3.0 — LGPL-3.0-or-later — https://github.com/rism-digital/verovio (source and build instructions)
- fflate 0.8.3 — MIT — https://github.com/101arrowz/fflate
- DOMPurify 3.4.15 — Apache-2.0 or MPL-2.0 — https://github.com/cure53/DOMPurify

The unmodified browser distributions are in `vendor/`. Source versions and dependency metadata are pinned in the project package lock. The separately downloaded local music-recognition engine is Audiveris 5.11.0 (AGPL-3.0), https://github.com/Audiveris/audiveris. Its executable and bundled runtime are not included in the hosted website.

The supplied Golden Lady chart remains the user's source material.

## Soundfonts (dist/vendor/soundfont)

Piano and bass samples are from the FluidR3_GM soundfont as rendered to MP3 by midi-js-soundfonts (https://github.com/gleitz/midi-js-soundfonts), Creative Commons Attribution 3.0 (https://creativecommons.org/licenses/by/3.0/us/). Trimmed to the note ranges the player uses and stored as base64 JSON.

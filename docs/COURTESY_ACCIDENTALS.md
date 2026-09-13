# Courtesy accidentals

The user requested courtesy accidentals on September 11, 2026. ScoreShift applies this display policy to existing and newly imported charts through `transposeScore` in `dist/music.mjs`, including the original key. The reader, transposed views, and its MusicXML/PDF exports share that path.

- Preserve the accidental marks encoded by the transcriber or imported MusicXML, including courtesy, editorial, size, bracket and parenthesis choices. Transposition changes the symbol to match the new written pitch.
- Add a parenthesized reminder when the first new attack of a pitch returns to the key signature after the same staff position had a different alteration at the end of the preceding measure. The reminder can be a natural, sharp, or flat depending on the key.
- Keep required within-measure alterations and cancellations as normal accidentals. Do not turn a required accidental into an optional reminder.
- Track musical time across voices, with separate state for each staff and octave. A bar without that pitch clears its reminder history. A real key-signature change clears affected history; a repeated unchanged signature does not.
- Do not automatically mark a tied continuation. A tie carries its sounding pitch, but does not establish accidental state for a new attack in the following bar. A return to the key after that tied note receives a reminder when needed.

This is a restrained default. It does not automatically add extra marks in other octaves or follow D.S./coda/repeat performance routes. Preserve source reminders at those locations and add explicitly reviewed ones where the route could confuse a player. Encode explicit reminders as `<accidental cautionary="yes" parentheses="yes">natural</accidental>` (or the actual sharp/flat), in MusicXML schema order. The pitch's `alter` remains the actual sounding alteration; adding a reminder must never change a pitch.

For every newly approved transcription, check source courtesy marks and the final reader rendering in the original, upward, and downward keys. Check accidental collisions and page fitting. Store the source reading independently of these editorial display additions. Original PDF scans and approved source artifacts are not rewritten by the reader; exporting MusicXML or PDF from the app includes the reminder marks.

`tests/courtesy.test.mjs` checks key restoration, ties, voice order, staff/octave boundaries, source-mark preservation, repeated rendering, and actual Verovio accidental/parenthesis glyphs. `npm test` includes these tests.

MusicXML encoding reference: [W3C MusicXML 4.0 accidental element](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/accidental/).

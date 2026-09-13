# Transposition across key changes

The reader transposes notes, structured harmony roots and slash basses at their musical onset. It keeps the selected starting key and uses that spelling again when the score returns to the same source key.

A later key signature that would require more than seven sharps or flats is respelled to an equivalent ordinary signature. Notes and chords in that section receive the matching spelling while sounding pitches move by exactly the requested semitone interval. Changing only the signature would be incorrect.

For example, Body and Soul's written D-flat / D / D-flat sections become B / C / B when lowered two semitones and D / E-flat / D when raised one. The earlier implementation applied the first section's spelling to the bridge too, producing theoretical signatures with twelve or nine sharps.

Key lookup follows musical time, including multiple voices, staff-specific keys, divisions changes, grace notes and signed harmony offsets. A tied note keeps the spelling of its attack through a key change; a subsequent new attack follows its current section. Authored accidental attributes and the courtesy policy in [COURTESY_ACCIDENTALS.md](COURTESY_ACCIDENTALS.md) remain relevant.

The regression suite is `tests/key-regions.test.mjs`, included in `npm test`. A release should also check complete charts through the actual reader's fitting pipeline in original, upward and downward transpositions, including every section after a key change. Exact sounding pitches, rhythms, harmony qualities, lyrics and performance form must remain intact. Evidence for the September 11 repair is under `output/key-regions/`.

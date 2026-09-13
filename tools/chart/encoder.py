"""chart.json -> MusicXML (+ deterministic MXL) for ScoreShift.

This is the ONE encoder for charts transcribed with tools/chart. The person (or the assistant)
reads the scan and writes a compact chart.json; this module turns it into partwise MusicXML
that the ScoreShift reader engraves, transposes and plays. Nothing here reads images: every
note comes from the JSON.

Token grammar for `notes` (one token per event, space separated):

    PITCH:RHYTHM[:flag...]

    PITCH   letter + accidentals + octave  (C4, Bb3, F#5, Cb5)      middle C is C4
            r = rest            x = rhythm slash (unpitched, transposition leaves it alone)
    RHYTHM  w whole  h half  q quarter  e eighth  s sixteenth
            d prefix = dotted (dq, de, dh)   dd prefix = double dotted
            t suffix = triplet (qt, et, st: three in the time of two)
            g = grace note (no duration; needs a following real note)
    flags   >   tie starts on this note        <   tie ends on this note      <> both
            acc     the scan prints an accidental here (source accidental; keeps the pitch)
            cacc    the scan prints a cautionary accidental in parentheses
            fer     fermata
            stacc   staccato        acc>    accent    ten   tenuto

Chords: "Symbol@beat" strings ("Cm7", "F7@3", "Bb/D@2.5", "N.C.", "/@3" for a repeat slash).
Beats are one-based within the measure and may be fractional (2.5 = the "and" of two).

See tools/chart/README.md for every measure-level field (repeats, endings, sections, lyrics,
navigation, key/time changes, systems). Timing is asserted while encoding: a wrong duration
fails here instead of silently producing a broken bar.
"""
from __future__ import annotations

import hashlib
import io
import json
import re
import sys
import zipfile
from fractions import Fraction
from pathlib import Path
import xml.etree.ElementTree as ET

DEFAULT_DIVISIONS = 12
BASE = {'w': 4, 'h': 2, 'q': 1, 'e': Fraction(1, 2), 's': Fraction(1, 4)}
TYPE = {'w': 'whole', 'h': 'half', 'q': 'quarter', 'e': 'eighth', 's': '16th'}
PITCH_RE = re.compile(r'^([A-G])([#b]*)(-?\d)$')
STEP_PC = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
FLAGS = {'>', '<', '<>', 'acc', 'cacc', 'fer', 'stacc', 'acc>', 'ten'}

# Chord quality -> (MusicXML kind, [(degree, alter, type)...]). Longest suffix match wins, then
# trailing alterations like b9 #11 add9 sus are parsed on top. The printed label stays the
# original text so the reader shows what the scan shows.
KINDS = {
    '': ('major', []), 'maj': ('major', []), 'M': ('major', []),
    'm': ('minor', []), 'min': ('minor', []), '-': ('minor', []),
    '7': ('dominant', []), 'maj7': ('major-seventh', []), 'M7': ('major-seventh', []),
    'Δ': ('major-seventh', []), 'Δ7': ('major-seventh', []),
    'm7': ('minor-seventh', []), '-7': ('minor-seventh', []), 'min7': ('minor-seventh', []),
    'mmaj7': ('major-minor', []), 'm(maj7)': ('major-minor', []), 'mM7': ('major-minor', []), '-Δ7': ('major-minor', []),
    'dim': ('diminished', []), 'o': ('diminished', []), '°': ('diminished', []),
    'dim7': ('diminished-seventh', []), 'o7': ('diminished-seventh', []), '°7': ('diminished-seventh', []),
    'm7b5': ('half-diminished', []), 'ø': ('half-diminished', []), 'ø7': ('half-diminished', []), '-7b5': ('half-diminished', []),
    'aug': ('augmented', []), '+': ('augmented', []), '#5': ('augmented', []),
    '6': ('major-sixth', []), 'm6': ('minor-sixth', []), '-6': ('minor-sixth', []),
    '69': ('major-sixth', [(9, 0, 'add')]), '6/9': ('major-sixth', [(9, 0, 'add')]), '6(9)': ('major-sixth', [(9, 0, 'add')]),
    'm69': ('minor-sixth', [(9, 0, 'add')]), 'm6/9': ('minor-sixth', [(9, 0, 'add')]),
    '9': ('dominant-ninth', []), 'maj9': ('major-ninth', []), 'M9': ('major-ninth', []), 'Δ9': ('major-ninth', []),
    'm9': ('minor-ninth', []), '-9': ('minor-ninth', []),
    '11': ('dominant-11th', []), 'm11': ('minor-11th', []), '-11': ('minor-11th', []),
    '13': ('dominant-13th', []), 'maj13': ('major-13th', []), 'm13': ('minor-13th', []),
    'sus': ('suspended-fourth', []), 'sus4': ('suspended-fourth', []), 'sus2': ('suspended-second', []),
    '7sus': ('suspended-fourth', [(7, -1, 'add')]), '7sus4': ('suspended-fourth', [(7, -1, 'add')]),
    '9sus': ('suspended-fourth', [(7, -1, 'add'), (9, 0, 'add')]), '9sus4': ('suspended-fourth', [(7, -1, 'add'), (9, 0, 'add')]),
    '13sus4': ('suspended-fourth', [(7, -1, 'add'), (9, 0, 'add'), (13, 0, 'add')]),
    'add9': ('major', [(9, 0, 'add')]), '(add9)': ('major', [(9, 0, 'add')]), 'madd9': ('minor', [(9, 0, 'add')]), 'm(add9)': ('minor', [(9, 0, 'add')]),
    'alt': ('dominant', [(5, 1, 'alter'), (9, 1, 'alter')]), '7alt': ('dominant', [(5, 1, 'alter'), (9, 1, 'alter')]),
    'power': ('power', []), '5': ('power', []),
}
ALTER_RE = re.compile(r'\(?([#b+-])(5|9|11|13)\)?')
ADD_RE = re.compile(r'\(?add(\d+)\)?')


class ChartError(ValueError):
    pass


def sub(parent, tag, value=None, **attrs):
    el = ET.SubElement(parent, tag, {k.replace('_', '-'): str(v) for k, v in attrs.items()})
    if value is not None:
        el.text = str(value)
    return el


def parse_pitch(pitch: str):
    m = PITCH_RE.match(pitch)
    if not m:
        raise ChartError(f'Bad pitch {pitch!r}')
    return m[1], m[2].count('#') - m[2].count('b'), int(m[3])


def midi(pitch: str) -> int:
    step, alter, octave = parse_pitch(pitch)
    return 12 * (octave + 1) + STEP_PC[step] + alter


def rhythm_units(rhythm: str, divisions: int):
    """Return (duration units, type name, dots, tuplet) for a rhythm token."""
    original = rhythm
    tuplet = rhythm.endswith('t') and len(rhythm) > 1 and rhythm != 't'
    if tuplet:
        rhythm = rhythm[:-1]
    dots = 0
    while rhythm.startswith('d') and len(rhythm) > 1:
        dots += 1
        rhythm = rhythm[1:]
    if rhythm not in BASE:
        raise ChartError(f'Bad rhythm {original!r}')
    quarters = Fraction(BASE[rhythm])
    quarters = quarters * (2 - Fraction(1, 2 ** dots))
    if tuplet:
        quarters = quarters * Fraction(2, 3)
    units = quarters * divisions
    if units.denominator != 1:
        raise ChartError(f'Rhythm {original!r} does not fit divisions={divisions}; raise "divisions"')
    return int(units), TYPE[rhythm], dots, tuplet


def parse_events(tokens: str, divisions: int, where: str):
    events = []
    for token in str(tokens).split():
        parts = token.split(':')
        if len(parts) < 2:
            raise ChartError(f'{where}: token {token!r} needs PITCH:RHYTHM')
        pitch, rhythm, *flags = parts
        for f in flags:
            if f not in FLAGS:
                raise ChartError(f'{where}: unknown flag {f!r} in {token!r}')
        grace = rhythm == 'g'
        if pitch not in ('r', 'x'):
            parse_pitch(pitch)
        elif grace:
            raise ChartError(f'{where}: a grace note needs a pitch ({token!r})')
        if grace:
            units, typ, dots, tuplet = 0, 'eighth', 0, False
        else:
            units, typ, dots, tuplet = rhythm_units(rhythm, divisions)
        tie = ''.join(f for f in flags if f in ('>', '<', '<>'))
        events.append({'token': token, 'pitch': pitch, 'rhythm': rhythm, 'duration': units, 'type': typ, 'dots': dots,
                       'tuplet': tuplet, 'grace': grace, 'tie': tie, 'accidental': 'acc' in flags, 'cautionary': 'cacc' in flags,
                       'fermata': 'fer' in flags, 'staccato': 'stacc' in flags, 'accent': 'acc>' in flags, 'tenuto': 'ten' in flags})
    return events


def parse_chord(item, divisions: int, where: str):
    if isinstance(item, dict):
        symbol, beat = item['symbol'], item.get('beat', 1)
    else:
        symbol, _, beat = str(item).partition('@')
        beat = float(beat) if beat else 1
    symbol = symbol.strip()
    offset = Fraction(str(beat)) - 1
    units = offset * divisions
    if units.denominator != 1 or units < 0:
        raise ChartError(f'{where}: chord beat {beat} does not land on a division')
    return {'symbol': symbol, 'offset': int(units)}


def parse_symbol(symbol: str):
    """Return (root_step, root_alter, kind, kind_text, degrees, bass_step, bass_alter) or None for N.C."""
    if symbol.upper() in ('N.C.', 'NC', 'N.C'):
        return None
    upper, _, bass = symbol.partition('/')
    m = re.match(r'^([A-G])([#b]?)(.*)$', upper)
    if not m:
        raise ChartError(f'Bad chord symbol {symbol!r}')
    step, acc, suffix = m.groups()
    rest = suffix
    kind, degrees = None, []
    for length in range(len(rest), -1, -1):
        head = rest[:length]
        if head in KINDS:
            kind, degrees = KINDS[head]
            degrees = list(degrees)
            rest = rest[length:]
            break
    if kind is None:
        raise ChartError(f'Unknown chord quality {suffix!r} in {symbol!r}; add it to KINDS in tools/chart/encoder.py')
    while rest:
        a = ALTER_RE.match(rest)
        d = ADD_RE.match(rest)
        if d:
            degrees.append((int(d[1]), 0, 'add'))
            rest = rest[d.end():]
        elif a:
            sign, degree = a.groups()
            alter = 1 if sign in '#+' else -1
            degrees.append((int(degree), alter, 'alter' if int(degree) == 5 else 'add'))
            rest = rest[a.end():]
        elif rest.startswith('sus4') or rest.startswith('sus'):
            degrees.append((4, 0, 'add')); degrees.append((3, 0, 'subtract'))
            rest = rest[4:] if rest.startswith('sus4') else rest[3:]
        else:
            raise ChartError(f'Unknown chord alteration {rest!r} in {symbol!r}')
    bass_step = bass_alter = None
    if bass:
        b = re.match(r'^([A-G])([#b]?)$', bass.strip())
        if not b:
            raise ChartError(f'Bad slash bass in {symbol!r}')
        bass_step, bass_alter = b[1], {'#': 1, 'b': -1, '': 0}[b[2]]
    return step, {'#': 1, 'b': -1, '': 0}[acc], kind, suffix, degrees, bass_step, bass_alter


def beam_groups(events, divisions: int, beats: int, beat_type: int):
    """Auto beams: notes shorter than a quarter, grouped inside a beaming bucket."""
    if beat_type == 8 and beats % 3 == 0:
        bucket = divisions * 3 // 2
    elif (beats, beat_type) in ((4, 4), (2, 2)):
        bucket = divisions * 2
    else:
        bucket = divisions * 4 // beat_type
    result, group, cursor, last = {}, [], 0, None

    def flush():
        if len(group) > 1:
            for i, idx in enumerate(group):
                result[idx] = 'begin' if i == 0 else 'end' if i == len(group) - 1 else 'continue'

    for idx, n in enumerate(events):
        if n['grace']:
            continue
        b = cursor // bucket
        short = 0 < n['duration'] < divisions and n['pitch'] != 'r'
        if not short or b != last or (group and events[group[-1]]['tuplet'] != n['tuplet']):
            flush(); group = []
        if short:
            group.append(idx)
        cursor += n['duration']; last = b
    flush()
    return result


def tuplet_edges(events):
    """Mark tuplet start/stop on runs of tuplet events whose durations sum to a plain value."""
    edges = {}
    i = 0
    while i < len(events):
        if not events[i]['tuplet']:
            i += 1; continue
        j = i
        while j < len(events) and events[j]['tuplet'] and events[j]['rhythm'] == events[i]['rhythm'] and j - i < 3:
            j += 1
        edges[i] = edges.get(i, '') + 'start'
        edges[j - 1] = edges.get(j - 1, '') + 'stop'
        i = j
    return edges


def syllabic(text: str, previous: str):
    start = text.endswith('-'); continuation = previous.endswith('-')
    return 'middle' if start and continuation else 'begin' if start else 'end' if continuation else 'single'


def write_notes(measure, events, m, chart, voice, state, mi):
    divisions = chart['divisions']
    beams = m.get('beams')
    if beams is not None:
        beam_map = {}
        for group in beams:
            for i, idx in enumerate(group):
                beam_map[idx] = 'begin' if i == 0 else 'end' if i == len(group) - 1 else 'continue'
    else:
        beam_map = beam_groups(events, divisions, state['beats'], state['beat_type'])
    tuplets = tuplet_edges(events)
    slurs = m.get('slurs', []) if voice == 1 else []
    lyrics = m.get('lyrics', []) if voice == 1 else []
    for verse in lyrics:
        if len(verse.split('|')) != len(events):
            raise ChartError(f'measure {mi + 1}: lyric verse has {len(verse.split("|"))} syllables for {len(events)} notes')
    whole_rest = len(events) == 1 and events[0]['pitch'] == 'r' and events[0]['duration'] == state['expected'] and not m.get('short')
    for idx, n in enumerate(events):
        attrs = {}
        if voice == 2 and n['pitch'] == 'r' and m.get('voice2_hidden_rests', True):
            attrs['print-object'] = 'no'
        el = sub(measure, 'note', **attrs)
        if n['grace']:
            sub(el, 'grace', slash='yes')
        p = n['pitch']
        if p == 'r':
            sub(el, 'rest', **({'measure': 'yes'} if whole_rest else {}))
        elif p == 'x':
            un = sub(el, 'unpitched'); sub(un, 'display-step', 'B'); sub(un, 'display-octave', 4)
        else:
            step, alter, octave = parse_pitch(p)
            pit = sub(el, 'pitch'); sub(pit, 'step', step)
            if alter:
                sub(pit, 'alter', alter)
            sub(pit, 'octave', octave)
        if not n['grace']:
            sub(el, 'duration', n['duration'])
        if '<' in n['tie']:
            sub(el, 'tie', type='stop')
        if '>' in n['tie']:
            sub(el, 'tie', type='start')
        sub(el, 'voice', voice)
        if not whole_rest:
            sub(el, 'type', n['type'])
            for _ in range(n['dots']):
                sub(el, 'dot')
        if p not in ('r', 'x') and (n['accidental'] or n['cautionary']):
            step, alter, _ = parse_pitch(p)
            name = {0: 'natural', 1: 'sharp', -1: 'flat', 2: 'double-sharp', -2: 'flat-flat'}[alter]
            sub(el, 'accidental', name, **({'cautionary': 'yes', 'parentheses': 'yes'} if n['cautionary'] else {}))
        if n['tuplet']:
            tm = sub(el, 'time-modification'); sub(tm, 'actual-notes', 3); sub(tm, 'normal-notes', 2); sub(tm, 'normal-type', n['type'])
        if voice == 2:
            sub(el, 'stem', 'down')
        if p == 'x':
            sub(el, 'stem', 'none' if n['duration'] >= divisions else 'up'); sub(el, 'notehead', 'slash')
        if idx in beam_map and not n['grace']:
            sub(el, 'beam', beam_map[idx], number=1)
            if n['type'] == '16th':
                prev = idx > 0 and events[idx - 1]['type'] == '16th' and (idx - 1) in beam_map
                nxt = idx + 1 < len(events) and events[idx + 1]['type'] == '16th' and (idx + 1) in beam_map
                sub(el, 'beam', 'continue' if prev and nxt else 'end' if prev else 'begin' if nxt else 'forward hook', number=2)
        slur_marks = [(j + 1, 'start' if idx == pair[0] else 'stop') for j, pair in enumerate(slurs) if idx in pair]
        art = [k for k in ('staccato', 'accent', 'tenuto') if n[k]]
        if n['tie'] or n['tuplet'] or slur_marks or n['fermata'] or art or idx in tuplets:
            no = sub(el, 'notations')
            if '<' in n['tie']:
                sub(no, 'tied', type='stop')
            if '>' in n['tie']:
                sub(no, 'tied', type='start')
            for num, typ in slur_marks:
                sub(no, 'slur', type=typ, number=num)
            if idx in tuplets:
                if 'start' in tuplets[idx]:
                    sub(no, 'tuplet', type='start', number=1, bracket='yes' if n['type'] == 'quarter' else 'no')
                if 'stop' in tuplets[idx]:
                    sub(no, 'tuplet', type='stop', number=1)
            if n['fermata']:
                sub(no, 'fermata')
            if art:
                ar = sub(no, 'articulations')
                for k in art:
                    sub(ar, k)
        if p != 'r':
            for vi, verse in enumerate(lyrics, 1):
                text = verse.split('|')[idx]
                if not text:
                    continue
                ly = sub(el, 'lyric', number=vi)
                previous = state['lyric'].get(vi, '')
                if text == '_':
                    sub(ly, 'extend'); continue
                sub(ly, 'syllabic', syllabic(text, previous)); sub(ly, 'text', text.rstrip('-'))
                state['lyric'][vi] = text


def direction(measure, text=None, mark=None, offset=0, placement='above', **sound):
    d = sub(measure, 'direction', placement=placement); dt = sub(d, 'direction-type')
    if text is not None:
        sub(dt, 'words', text)
    if mark:
        sub(sub(d, 'direction-type') if text is not None else dt, mark)
    if offset:
        sub(d, 'offset', offset)
    if sound:
        sub(d, 'sound', **sound)
    return d


def harmony(measure, chord, divisions):
    if chord['symbol'].strip() == '/':
        d = direction(measure, '/', offset=chord['offset']); d.find('direction-type/words').set('font-style', 'normal'); return
    parsed = parse_symbol(chord['symbol'])
    if parsed is None:
        direction(measure, 'N.C.', offset=chord['offset']); return
    step, alter, kind, text, degrees, bass_step, bass_alter = parsed
    el = sub(measure, 'harmony'); r = sub(el, 'root'); sub(r, 'root-step', step)
    if alter:
        sub(r, 'root-alter', alter)
    sub(el, 'kind', kind, text=text)
    if bass_step:
        be = sub(el, 'bass'); sub(be, 'bass-step', bass_step)
        if bass_alter:
            sub(be, 'bass-alter', bass_alter)
    for value, dalter, typ in degrees:
        de = sub(el, 'degree', print_object='no'); sub(de, 'degree-value', value); sub(de, 'degree-alter', dalter); sub(de, 'degree-type', typ)
    if chord['offset']:
        sub(el, 'offset', chord['offset'])


def parse_time(text):
    m = re.match(r'^(\d+)/(\d+)$', str(text))
    if not m:
        raise ChartError(f'Bad time signature {text!r} (use "4/4")')
    return int(m[1]), int(m[2])


def normalize(chart: dict) -> dict:
    chart = dict(chart)
    chart.setdefault('divisions', DEFAULT_DIVISIONS)
    for key in ('id', 'title', 'measures'):
        if key not in chart:
            raise ChartError(f'chart.json needs "{key}"')
    if not re.match(r'^[a-z0-9][a-z0-9-]*$', chart['id']):
        raise ChartError('chart id must be lowercase letters, digits and dashes')
    if not chart['measures']:
        raise ChartError('chart has no measures yet')
    chart.setdefault('key', 0); chart.setdefault('time', '4/4'); chart.setdefault('clef', 'G')
    return chart


def build(chart: dict) -> bytes:
    chart = normalize(chart)
    divisions = chart['divisions']
    root = ET.Element('score-partwise', version='4.0')
    sub(sub(root, 'work'), 'work-title', chart['title'])
    ident = sub(root, 'identification')
    if chart.get('composer'):
        sub(ident, 'creator', chart['composer'], type='composer')
    enc = sub(ident, 'encoding'); sub(enc, 'software', 'ScoreShift chart encoder (tools/chart)')
    source = chart.get('source', {})
    sub(enc, 'encoding-description', f"Visual transcription of {source.get('file', 'the supplied scan')} ({source.get('pages', '?')} page(s)); no OCR. See notes.md.")
    sub(sub(ident, 'miscellaneous'), 'miscellaneous-field', 'encoded', name='scoreshift-layout')
    defaults = sub(root, 'defaults'); sc = sub(defaults, 'scaling'); sub(sc, 'millimeters', 7); sub(sc, 'tenths', 40)
    layout = sub(defaults, 'page-layout'); sub(layout, 'page-height', 1596.571); sub(layout, 'page-width', 1234.286)
    margins = sub(layout, 'page-margins', type='both')
    for side in ('left', 'right', 'top', 'bottom'):
        sub(margins, side + '-margin', 57.143)
    sub(defaults, 'word-font', font_family='Arial', font_size=10); sub(defaults, 'lyric-font', font_family='Arial', font_size=10)
    pl = sub(root, 'part-list'); sp = sub(pl, 'score-part', id='P1'); sub(sp, 'part-name', chart.get('part', 'Melody'))
    part = sub(root, 'part', id='P1')
    beats, beat_type = parse_time(chart['time'])
    state = {'beats': beats, 'beat_type': beat_type, 'expected': divisions * beats * 4 // beat_type, 'lyric': {}, 'ending': None}
    number = 0
    measures = chart['measures']
    for mi, m in enumerate(measures):
        implicit = bool(m.get('pickup') or m.get('implicit'))
        if not implicit:
            number += 1
        measure = sub(part, 'measure', number=(number if not implicit else 0) if not m.get('number') else m['number'], **({'implicit': 'yes'} if implicit else {}))
        if m.get('system') or m.get('page'):
            sub(measure, 'print', new_system='yes', **({'new-page': 'yes'} if m.get('page') else {}))
        first = mi == 0
        changes = first or 'key' in m or 'time' in m or 'clef' in m or 'mode' in m
        if changes:
            at = sub(measure, 'attributes')
            if first:
                sub(at, 'divisions', divisions)
            if first or 'key' in m or 'mode' in m:
                fifths = m.get('key', chart['key'] if first else None)
                if fifths is None:
                    fifths = state.get('fifths', chart['key'])
                if not -7 <= int(fifths) <= 7:
                    raise ChartError(f'measure {mi + 1}: key fifths {fifths} out of range')
                k = sub(at, 'key'); sub(k, 'fifths', fifths)
                mode = m.get('mode', chart.get('mode') if first else None)
                if mode:
                    sub(k, 'mode', mode)
                state['fifths'] = int(fifths)
            if first or 'time' in m:
                beats, beat_type = parse_time(m.get('time', chart['time']))
                state.update(beats=beats, beat_type=beat_type, expected=divisions * beats * 4 // beat_type)
                t = sub(at, 'time'); sub(t, 'beats', beats); sub(t, 'beat-type', beat_type)
            if first or 'clef' in m:
                clef = m.get('clef', chart['clef'])
                c = sub(at, 'clef'); sub(c, 'sign', clef); sub(c, 'line', 4 if clef == 'F' else 2)
        if first and chart.get('feel'):
            direction(measure, chart['feel'])
        if first and chart.get('tempo'):
            d = sub(measure, 'direction', placement='above'); met = sub(sub(d, 'direction-type'), 'metronome')
            sub(met, 'beat-unit', 'quarter'); sub(met, 'per-minute', chart['tempo']); sub(d, 'sound', tempo=chart['tempo'])
        if m.get('section'):
            d = sub(measure, 'direction', placement='above'); sub(sub(d, 'direction-type'), 'rehearsal', m['section'])
        if m.get('segno'):
            direction(measure, mark='segno', segno='segno')
        if m.get('coda'):
            direction(measure, mark='coda', coda='coda')
        if m.get('words'):
            direction(measure, m['words'])
        for t in m.get('text', []):
            direction(measure, t['text'], offset=int((Fraction(str(t.get('beat', 1))) - 1) * divisions), placement='below' if t.get('below') else 'above')
        # Left barline: repeat start and/or ending start.
        ending = m.get('ending')
        repeat = m.get('repeat', '')
        starts = repeat in ('start', 'both')
        if ending is not None or starts or m.get('double_left'):
            bl = sub(measure, 'barline', location='left')
            if m.get('double_left'):
                sub(bl, 'bar-style', 'light-light')
            if ending is not None:
                if state['ending'] is not None:
                    raise ChartError(f'measure {mi + 1}: ending {ending} starts while ending {state["ending"]} is still open')
                sub(bl, 'ending', number=str(ending).replace(' ', ''), type='start')
                state['ending'] = str(ending).replace(' ', '')
            if starts:
                sub(bl, 'repeat', direction='forward')
        for chord in m.get('chords', []):
            harmony(measure, parse_chord(chord, divisions, f'measure {mi + 1}'), divisions)
        events = parse_events(m.get('notes', ''), divisions, f'measure {mi + 1}')
        if not events:
            raise ChartError(f'measure {mi + 1}: no notes (use "r:w" for a whole-bar rest)')
        total = sum(e['duration'] for e in events)
        expected = state['expected']
        if implicit or m.get('short'):
            if not 0 < total <= expected:
                raise ChartError(f'measure {mi + 1}: pickup/short bar holds {total} units, more than a full bar ({expected})')
        elif total != expected:
            raise ChartError(f'measure {mi + 1}: notes total {total} units, expected {expected} for {state["beats"]}/{state["beat_type"]} ({" ".join(e["token"] for e in events)})')
        for chord in m.get('chords', []):
            if parse_chord(chord, divisions, '')['offset'] >= total:
                raise ChartError(f'measure {mi + 1}: chord {chord} starts after the bar ends')
        write_notes(measure, events, m, chart, 1, state, mi)
        if m.get('voice2'):
            v2 = parse_events(m['voice2'], divisions, f'measure {mi + 1} voice2')
            if sum(e['duration'] for e in v2) != total:
                raise ChartError(f'measure {mi + 1}: voice2 totals {sum(e["duration"] for e in v2)} units, voice 1 has {total}')
            sub(sub(measure, 'backup'), 'duration', total)
            write_notes(measure, v2, m, chart, 2, state, mi)
        if m.get('to_coda'):
            direction(measure, 'To Coda', mark='coda', tocoda='coda')
        if m.get('fine'):
            d = direction(measure, 'Fine', placement='below', fine='yes'); d.find('direction-type/words').set('halign', 'right')
        if m.get('ds'):
            text = m['ds'] if isinstance(m['ds'], str) else 'D.S. al Coda'
            sound = {'dalsegno': 'segno'}
            if 'coda' in text.lower():
                sound['tocoda'] = 'coda'
            if 'fine' in text.lower():
                sound['fine'] = 'yes'
            d = direction(measure, text, placement='below', **sound); d.find('direction-type/words').set('halign', 'right')
        if m.get('dc'):
            text = m['dc'] if isinstance(m['dc'], str) else 'D.C. al Fine'
            sound = {'dacapo': 'yes'}
            if 'coda' in text.lower():
                sound['tocoda'] = 'coda'
            d = direction(measure, text, placement='below', **sound); d.find('direction-type/words').set('halign', 'right')
        # Right barline: repeat end, ending close, double or final.
        ends = repeat in ('end', 'both')
        # An ending bracket closes at a repeat end, a double or final barline, an explicit
        # ending_stop, the last bar, or right before the next ending starts.
        close_ending = state['ending'] is not None and (ends or m.get('ending_stop') or m.get('double') or m.get('final')
                                                        or mi + 1 == len(measures) or measures[mi + 1].get('ending') is not None)
        if ends or close_ending or m.get('double') or m.get('final'):
            bl = sub(measure, 'barline', location='right')
            if m.get('final'):
                sub(bl, 'bar-style', 'light-heavy')
            elif m.get('double'):
                sub(bl, 'bar-style', 'light-light')
            if close_ending:
                sub(bl, 'ending', number=state['ending'], type='stop' if ends else 'discontinue')
                state['ending'] = None
            if ends:
                sub(bl, 'repeat', direction='backward')
    ET.indent(root)
    return ET.tostring(root, encoding='utf-8', xml_declaration=True)


def package(name: str, xml: bytes) -> bytes:
    """Deterministic MXL: fixed timestamps so identical music gives identical bytes."""
    target = io.BytesIO()
    container = (f'<?xml version="1.0"?><container><rootfiles><rootfile full-path="{name}" '
                 'media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>').encode()
    entries = [('mimetype', b'application/vnd.recordare.musicxml', zipfile.ZIP_STORED),
               ('META-INF/container.xml', container, zipfile.ZIP_DEFLATED), (name, xml, zipfile.ZIP_DEFLATED)]
    with zipfile.ZipFile(target, 'w') as z:
        for entry, content, method in entries:
            info = zipfile.ZipInfo(entry, date_time=(1980, 1, 1, 0, 0, 0)); info.compress_type = method; info.external_attr = 0o644 << 16
            z.writestr(info, content)
    return target.getvalue()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write(folder: Path) -> dict:
    folder = Path(folder)
    chart = json.loads((folder / 'chart.json').read_text(encoding='utf-8'))
    xml = build(chart)
    name = chart['id'] + '.musicxml'
    mxl = package(name, xml)
    (folder / name).write_bytes(xml); (folder / (chart['id'] + '.mxl')).write_bytes(mxl)
    return {'id': chart['id'], 'measures': len(chart['measures']), 'musicxml': name, 'mxl': chart['id'] + '.mxl',
            'musicxml_sha256': sha256(xml), 'mxl_sha256': sha256(mxl)}


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: python tools/chart/encoder.py charts/<book>/<id>')
    try:
        print(json.dumps(write(Path(sys.argv[1])), indent=1))
    except ChartError as error:
        sys.exit(f'chart error: {error}')

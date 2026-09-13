"""Encoder + publisher unit tests: python -m unittest discover -s tools/chart/tests -p "test_*.py" """
import json
import sys
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import encoder  # noqa: E402
import chart as cli  # noqa: E402

FIXTURE = HERE / 'fixtures' / 'example-book-porch-light' / 'chart.json'


def minimal(**measure):
    return {'id': 'test-tune', 'title': 'Test', 'measures': [dict({'notes': 'C4:w'}, **measure)]}


class Rhythms(unittest.TestCase):
    def test_units_with_divisions_12(self):
        self.assertEqual(encoder.rhythm_units('q', 12)[0], 12)
        self.assertEqual(encoder.rhythm_units('dq', 12)[0], 18)
        self.assertEqual(encoder.rhythm_units('et', 12)[0], 4)
        self.assertEqual(encoder.rhythm_units('qt', 12)[0], 8)
        self.assertEqual(encoder.rhythm_units('s', 12)[0], 3)
        self.assertEqual(encoder.rhythm_units('ddq', 12), (21, 'quarter', 2, False))
        self.assertEqual(encoder.rhythm_units('st', 12)[0], 2)
        with self.assertRaises(encoder.ChartError):
            encoder.rhythm_units('zz', 12)

    def test_bad_bar_is_refused_with_the_bar_number(self):
        with self.assertRaisesRegex(encoder.ChartError, 'measure 1: notes total 36 units, expected 48'):
            encoder.build(minimal(notes='C4:h C4:q'))
        with self.assertRaisesRegex(encoder.ChartError, 'Bad pitch'):
            encoder.build(minimal(notes='H4:w'))
        with self.assertRaisesRegex(encoder.ChartError, 'unknown flag'):
            encoder.build(minimal(notes='C4:w:zzz'))

    def test_pickup_and_short_bars_may_be_shorter(self):
        xml = encoder.build({'id': 'x', 'title': 'X', 'measures': [{'pickup': True, 'notes': 'C4:e D4:e'}, {'notes': 'E4:w', 'final': True}]})
        root = ET.fromstring(xml)
        measures = root.findall('.//measure')
        self.assertEqual(measures[0].get('implicit'), 'yes')
        self.assertEqual(measures[1].get('number'), '1')


class Chords(unittest.TestCase):
    def test_symbols_keep_their_label_and_get_semantic_roots(self):
        step, alter, kind, text, degrees, bstep, balter = encoder.parse_symbol('Bbm7b5/Ab')
        self.assertEqual((step, alter, kind, text, bstep, balter), ('B', -1, 'half-diminished', 'm7b5', 'A', -1))
        self.assertEqual(encoder.parse_symbol('F#7#9')[2:5], ('dominant', '7#9', [(9, 1, 'add')]))
        self.assertEqual(encoder.parse_symbol('C69')[2], 'major-sixth')
        self.assertEqual(encoder.parse_symbol('Gsus')[2], 'suspended-fourth')
        self.assertEqual(encoder.parse_symbol('D-7')[2], 'minor-seventh')
        self.assertEqual(encoder.parse_symbol('Ebmaj7#11')[4], [(11, 1, 'add')])
        self.assertIsNone(encoder.parse_symbol('N.C.'))
        with self.assertRaisesRegex(encoder.ChartError, 'Unknown chord'):
            encoder.parse_symbol('Cxyz')

    def test_chord_beats_land_on_divisions(self):
        self.assertEqual(encoder.parse_chord('F7@3', 12, '')['offset'], 24)
        self.assertEqual(encoder.parse_chord('F7@2.5', 12, '')['offset'], 18)
        with self.assertRaises(encoder.ChartError):
            encoder.parse_chord('F7@1.1', 12, '')
        with self.assertRaisesRegex(encoder.ChartError, 'after the bar ends'):
            encoder.build(minimal(chords=['C7@5']))


class Structure(unittest.TestCase):
    def setUp(self):
        self.xml = encoder.build(json.loads(FIXTURE.read_text(encoding='utf-8')))
        self.root = ET.fromstring(self.xml)

    def test_repeats_endings_and_navigation(self):
        barlines = self.root.findall('.//barline')
        self.assertEqual([r.get('direction') for r in self.root.findall('.//repeat')], ['forward', 'backward'])
        endings = [(e.get('number'), e.get('type')) for e in self.root.findall('.//ending')]
        self.assertEqual(endings, [('1', 'start'), ('1', 'stop'), ('2', 'start'), ('2', 'discontinue')])
        self.assertEqual(len(self.root.findall('.//segno')) + len(self.root.findall('.//coda')), 3)  # coda mark, to-coda, coda
        self.assertEqual(len([b for b in barlines if b.find('bar-style') is not None and b.find('bar-style').text == 'light-heavy']), 1)
        self.assertEqual(self.root.find('.//miscellaneous-field[@name="scoreshift-layout"]').text, 'encoded')

    def test_lyrics_hyphenation_and_extend(self):
        syllabics = [s.text for s in self.root.findall('.//lyric/syllabic')]
        self.assertEqual(syllabics[:5], ['single', 'single', 'single', 'begin', 'end'])
        self.assertEqual(len(self.root.findall('.//lyric/extend')), 2)

    def test_slashes_are_unpitched_and_key_changes_apply(self):
        self.assertEqual(len(self.root.findall('.//unpitched')), 8)
        self.assertEqual([k.text for k in self.root.findall('.//key/fifths')], ['-1', '1'])
        tuplets = self.root.findall('.//time-modification')
        self.assertEqual(len(tuplets), 6)

    def test_package_is_deterministic(self):
        a = encoder.package('x.musicxml', self.xml)
        b = encoder.package('x.musicxml', self.xml)
        self.assertEqual(a, b)
        self.assertTrue(a.startswith(b'PK'))


class Publisher(unittest.TestCase):
    def test_only_catalog_and_sample_paths_may_be_written(self):
        cli.guard_paths(['/catalog/books.json', '/catalog/dads-charts.json', '/samples/dads-charts/x.mxl'])
        for bad in ['/transcriptions.mjs', '/samples/real-book/x.mxl', '/samples/colorado-cookbook/x.pdf', '/index.html', '/samples/golden-lady.pdf', '/real-book-progress.json']:
            with self.assertRaises(SystemExit):
                cli.guard_paths([bad])

    def test_catalog_entries_come_from_approvals(self):
        folder = FIXTURE.parent
        approval = {'id': 'example-book-porch-light', 'title': 'Porch Light', 'composer': 'Fixture', 'pages': 1, 'revision': 3}
        item = {'book': {'id': 'example-book'}, 'entry': {'id': approval['id'], 'title': 'Porch Light'}, 'approval': approval, 'folder': folder}
        if not (folder / 'example-book-porch-light.mxl').exists():
            encoder.write(folder)
        (folder / 'source.pdf').write_bytes(b'%PDF-1.4 fixture') if not (folder / 'source.pdf').exists() else None
        files = cli.catalog_files([item])
        self.assertEqual(sorted(files), ['/catalog/example-book.json', '/samples/example-book/example-book-porch-light.mxl', '/samples/example-book/example-book-porch-light.pdf'])
        entries = json.loads(files['/catalog/example-book.json'])
        self.assertEqual(entries, [{'id': 'example-book-porch-light', 'title': 'Porch Light', 'pages': 1, 'revision': 3, 'assetBase': '/samples/example-book/example-book-porch-light', 'composer': 'Fixture'}])


if __name__ == '__main__':
    unittest.main()

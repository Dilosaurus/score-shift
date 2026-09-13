"""ScoreShift chart pipeline: one PDF in, one catalog chart out.

    python tools/chart/chart.py new "C:/path/song.pdf" --book dads-charts --title "Blue Bossa" [--composer ...] [--pages 1-2]
    python tools/chart/chart.py systems <id> --page 1 --count 8        # one crop per staff system
    python tools/chart/chart.py crop <id> --page 1 --box 0.10,0.22,0.90,0.36 [--dpi 600]
    python tools/chart/chart.py build <id>                             # chart.json -> MusicXML + MXL
    python tools/chart/chart.py check <id>                             # schema + reader checks + review renders
    python tools/chart/chart.py approve <id>                           # pin hashes; mark ready in the book
    python tools/chart/chart.py publish [--book ID] [--dry-run | --verify-only]
    python tools/chart/chart.py status

Books are registered in books/<book>.json (created by `new --book-title "..."` the first time).
Charts live in charts/<book>/<id>/. Publishing writes ONLY /catalog/books.json, /catalog/<book>.json
and /samples/<book>/<id>.{mxl,pdf} on Firebase Hosting, merged into the live release; every other
live file (the app, the Real Book and Colorado catalogs) is carried over untouched.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
BOOKS = ROOT / 'books'
CHARTS = ROOT / 'charts'
RECEIPTS = CHARTS / '.publish'
ID_RE = re.compile(r'^[a-z0-9][a-z0-9-]*$')
# Paths only Chris's Real Book / Colorado pipeline may write. The publisher refuses to touch them.
FORBIDDEN_PREFIXES = ('/samples/real-book/', '/samples/colorado-cookbook/', '/samples/golden-lady')
FORBIDDEN_PATHS = {'/transcriptions.mjs', '/transcription-books.json', '/real-book-progress.json', '/colorado-cookbook-progress.json'}

sys.path.insert(0, str(HERE))
import encoder  # noqa: E402

spec = importlib.util.spec_from_file_location('hosting_deploy', ROOT / 'deploy-hosting.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
API = deploy.API


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_json(path: Path):
    return json.loads(path.read_text(encoding='utf-8'))


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    os.replace(tmp, path)


def slug(text: str) -> str:
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', text.lower())).strip('-')


def find_chart(chart_id: str) -> Path:
    matches = [p for p in CHARTS.glob(f'*/{chart_id}') if p.is_dir()]
    if not matches:
        sys.exit(f'No chart folder named {chart_id!r} under charts/. Run `chart.py new` first, or check `chart.py status`.')
    return matches[0]


def load_book(book_id: str, title: str | None = None, subtitle: str = '') -> dict:
    if not ID_RE.match(book_id):
        sys.exit('A book id is lowercase letters, digits and dashes, e.g. dads-charts')
    path = BOOKS / f'{book_id}.json'
    if path.exists():
        return read_json(path)
    if not title:
        sys.exit(f'Book {book_id!r} does not exist yet. Add --book-title "The printed book or collection name" to create it.')
    book = {'id': book_id, 'title': title, 'subtitle': subtitle, 'created_at': now(), 'charts': []}
    write_json(path, book)
    print(f'registered book {book_id}: {title}')
    return book


def save_book(book: dict) -> None:
    write_json(BOOKS / f"{book['id']}.json", book)


# ---------------------------------------------------------------- new / crops

def cmd_new(args) -> None:
    import fitz  # PyMuPDF
    source = Path(args.pdf).expanduser().resolve()
    if not source.is_file():
        sys.exit(f'PDF not found: {source}')
    book = load_book(args.book, args.book_title, args.book_subtitle or '')
    chart_id = args.id or slug(f"{args.book}-{args.title}")
    if not ID_RE.match(chart_id):
        sys.exit(f'Bad chart id {chart_id!r}')
    folder = CHARTS / args.book / chart_id
    if folder.exists() and not args.force:
        sys.exit(f'{folder} already exists. Pick another --id or pass --force to start it over.')
    doc = fitz.open(str(source))
    first, last = 1, doc.page_count
    if args.pages:
        m = re.match(r'^(\d+)(?:-(\d+))?$', args.pages)
        if not m:
            sys.exit('--pages looks like 3 or 3-4 (1-based pages of the PDF you supplied)')
        first, last = int(m[1]), int(m[2] or m[1])
    if not 1 <= first <= last <= doc.page_count:
        sys.exit(f'--pages {args.pages} is outside this PDF ({doc.page_count} pages)')
    (folder / 'source').mkdir(parents=True, exist_ok=True)
    extract = fitz.open()
    extract.insert_pdf(doc, from_page=first - 1, to_page=last - 1)
    extract.save(str(folder / 'source.pdf'), garbage=4, deflate=True)
    extract.close()
    check = fitz.open(str(folder / 'source.pdf'))
    pages = []
    for i in range(check.page_count):
        a = doc[first - 1 + i].get_pixmap(matrix=fitz.Matrix(2, 2))
        b = check[i].get_pixmap(matrix=fitz.Matrix(2, 2))
        if (a.width, a.height) != (b.width, b.height) or a.samples != b.samples:
            sys.exit('Extracted page pixels differ from the source; refusing to continue')
        png = folder / 'source' / f'page-{i + 1}.png'
        check[i].get_pixmap(matrix=fitz.Matrix(args.dpi / 72, args.dpi / 72)).save(str(png))
        pages.append({'page': i + 1, 'source_page': first + i, 'png': f'source/page-{i + 1}.png', 'width': check[i].rect.width, 'height': check[i].rect.height})
    source_bytes = (folder / 'source.pdf').read_bytes()
    chart = {
        'id': chart_id, 'book': args.book, 'title': args.title, 'composer': args.composer or '',
        'source': {'file': 'source.pdf', 'sha256': sha(source_bytes), 'pages': check.page_count,
                   'original_file': source.name, 'original_sha256': sha(source.read_bytes()), 'original_pages': f'{first}-{last}',
                   'rendered_dpi': args.dpi, 'page_images': pages},
        'divisions': 12, 'key': 0, 'mode': 'major', 'time': '4/4', 'clef': 'G',
        'measures': [],
        'review': {'source_checked': False, 'unresolved': []},
    }
    write_json(folder / 'chart.json', chart)
    notes = folder / 'notes.md'
    if not notes.exists():
        notes.write_text(f"# {args.title}\n\nSource: {source.name}, pages {first}-{last} ({check.page_count} page(s)), sha256 {sha(source_bytes)[:16]}…\n\n"
                         "## Source map (page → system → written measures)\n\n| Page | System | Measures | Notes |\n|---|---|---|---|\n\n"
                         "## Readings that needed a closer look\n\n(none yet)\n\n## Verification\n\n(filled in after `check`)\n", encoding='utf-8')
    if not any(c['id'] == chart_id for c in book['charts']):
        book['charts'].append({'id': chart_id, 'title': args.title, 'composer': args.composer or '', 'pages': check.page_count, 'status': 'transcribing', 'revision': 0})
        save_book(book)
    print(json.dumps({'chart': chart_id, 'folder': str(folder.relative_to(ROOT)), 'pages': pages}, indent=1))


def render_region(folder: Path, page: int, box, dpi: int, name: str) -> Path:
    import fitz
    doc = fitz.open(str(folder / 'source.pdf'))
    if not 1 <= page <= doc.page_count:
        sys.exit(f'source.pdf has {doc.page_count} page(s)')
    pg = doc[page - 1]
    r = pg.rect
    clip = fitz.Rect(r.x0 + box[0] * r.width, r.y0 + box[1] * r.height, r.x0 + box[2] * r.width, r.y0 + box[3] * r.height)
    out = folder / 'source' / name
    out.parent.mkdir(parents=True, exist_ok=True)
    pg.get_pixmap(matrix=fitz.Matrix(dpi / 72, dpi / 72), clip=clip).save(str(out))
    return out


def cmd_crop(args) -> None:
    folder = find_chart(args.id)
    box = [float(v) for v in args.box.split(',')]
    if len(box) != 4 or not all(0 <= v <= 1 for v in box) or box[0] >= box[2] or box[1] >= box[3]:
        sys.exit('--box is x0,y0,x1,y1 as fractions of the page, e.g. 0.05,0.20,0.95,0.34')
    tag = '-'.join(f'{v:.2f}'.replace('.', '') for v in box)
    out = render_region(folder, args.page, box, args.dpi, f'crops/page-{args.page}-{tag}.png')
    print(out.relative_to(ROOT).as_posix())


def cmd_systems(args) -> None:
    folder = find_chart(args.id)
    top, bottom, count = args.top, args.bottom, args.count
    band = (bottom - top) / count
    overlap = band * 0.18
    outputs = []
    for i in range(count):
        y0 = max(0.0, top + i * band - overlap)
        y1 = min(1.0, top + (i + 1) * band + overlap)
        out = render_region(folder, args.page, [0.0, y0, 1.0, y1], args.dpi, f'systems/page-{args.page}-system-{i + 1}.png')
        outputs.append(out.relative_to(ROOT).as_posix())
    print('\n'.join(outputs))


# ---------------------------------------------------------------- build / check / approve

def cmd_build(args) -> None:
    folder = find_chart(args.id)
    try:
        print(json.dumps(encoder.write(folder), indent=1))
    except encoder.ChartError as error:
        sys.exit(f'chart error: {error}')


def validate_schema(xml_path: Path) -> dict:
    from lxml import etree
    schema_dir = HERE / 'schema'

    class Local(etree.Resolver):
        def resolve(self, url, pubid, context):
            name = url.rsplit('/', 1)[-1]
            if name in ('xml.xsd', 'xlink.xsd'):
                return self.resolve_filename(str(schema_dir / name), context)

    parser = etree.XMLParser(no_network=True)
    parser.resolvers.add(Local())
    schema = etree.XMLSchema(etree.parse(str(schema_dir / 'musicxml.xsd'), parser))
    doc = etree.parse(str(xml_path))
    valid = schema.validate(doc)
    return {'valid': valid, 'version': '4.0', 'errors': [str(e) for e in list(schema.error_log)[:20]]}


def node() -> str:
    import shutil
    found = shutil.which('node')
    if not found:
        sys.exit('Node.js is not installed or not on PATH (see docs/DAD_SETUP.md)')
    return found


def cmd_check(args) -> None:
    folder = find_chart(args.id)
    chart = read_json(folder / 'chart.json')
    try:
        built = encoder.write(folder)
    except encoder.ChartError as error:
        sys.exit(f'chart error: {error}')
    schema = validate_schema(folder / built['musicxml'])
    result = subprocess.run([node(), str(HERE / 'check.mjs'), str(folder)] + (['--no-render'] if args.no_render else []),
                            capture_output=True, text=True, encoding='utf-8', cwd=ROOT)
    raw = result.stdout
    try:
        report = json.loads(raw[raw.index('{'):])
    except ValueError:
        sys.exit('check.mjs did not report:\n' + (result.stderr or raw)[-2000:])
    report['checks']['schema'] = schema['valid']
    report['schema'] = schema
    report['ok'] = all(report['checks'].values())
    report['source_sha256'] = chart.get('source', {}).get('sha256')
    write_json(folder / 'verification.json', report)
    summary = {k: report[k] for k in ('id', 'ok', 'checks', 'counts', 'pages')}
    summary['failures'] = report['failures'] + ([{'check': 'schema', 'message': e} for e in schema['errors']] if not schema['valid'] else [])
    summary['renders'] = [r['png'] for r in report['renders']]
    print(json.dumps(summary, indent=1))
    if not report['ok']:
        sys.exit(1)


def artifacts(folder: Path, chart: dict) -> dict:
    files = {'chart.json': folder / 'chart.json', 'mxl': folder / f"{chart['id']}.mxl", 'musicxml': folder / f"{chart['id']}.musicxml",
             'pdf': folder / 'source.pdf', 'verification.json': folder / 'verification.json'}
    return {name: sha(path.read_bytes()) for name, path in files.items() if path.exists()}


def cmd_approve(args) -> None:
    folder = find_chart(args.id)
    chart = read_json(folder / 'chart.json')
    verification = folder / 'verification.json'
    if not verification.exists():
        sys.exit('Run `chart.py check` first')
    report = read_json(verification)
    current = artifacts(folder, chart)
    if not report.get('ok'):
        sys.exit('The last check failed; fix the chart and run `check` again')
    if report['inputs']['chart.json'] != current['chart.json'] or report['inputs']['mxl'] != current['mxl']:
        sys.exit('chart.json or the MXL changed after the last check; run `check` again')
    if report.get('source_sha256') != chart['source']['sha256'] or sha((folder / 'source.pdf').read_bytes()) != chart['source']['sha256']:
        sys.exit('source.pdf does not match chart.json; the scan must be the one that was read')
    review = chart.get('review', {})
    if review.get('source_checked') is not True:
        sys.exit('chart.json review.source_checked must be true: compare every rendered page against the scan first')
    if review.get('unresolved'):
        sys.exit('chart.json review.unresolved still lists readings: ' + '; '.join(map(str, review['unresolved'])))
    if not report.get('renders'):
        sys.exit('No renders were produced; run `check` without --no-render')
    book = load_book(chart['book'])
    entry = next((c for c in book['charts'] if c['id'] == chart['id']), None)
    if entry is None:
        entry = {'id': chart['id'], 'title': chart['title'], 'composer': chart.get('composer', ''), 'pages': chart['source']['pages'], 'status': 'transcribing', 'revision': 0}
        book['charts'].append(entry)
    previous = folder / 'approval.json'
    revision = entry.get('revision', 0)
    if not previous.exists() or read_json(previous)['artifacts']['mxl'] != current['mxl']:
        revision += 1
    approval = {'id': chart['id'], 'book': chart['book'], 'title': chart['title'], 'composer': chart.get('composer', ''), 'pages': chart['source']['pages'],
                'revision': revision, 'approved_at': now(), 'artifacts': current, 'checks': report['checks'], 'renders': report['renders'],
                'reviewer_note': args.note or ''}
    write_json(previous, approval)
    entry.update(title=chart['title'], composer=chart.get('composer', ''), pages=chart['source']['pages'], status='ready', revision=revision, approved_at=approval['approved_at'])
    save_book(book)
    print(json.dumps({'approved': chart['id'], 'revision': revision, 'book': chart['book']}, indent=1))


# ---------------------------------------------------------------- publish

def approved_charts(book_filter: str | None):
    result = []
    for path in sorted(BOOKS.glob('*.json')):
        book = read_json(path)
        if book_filter and book['id'] != book_filter:
            continue
        for entry in book['charts']:
            if entry.get('status') != 'ready':
                continue
            folder = CHARTS / book['id'] / entry['id']
            approval_path = folder / 'approval.json'
            if not approval_path.exists():
                sys.exit(f"{entry['id']} is marked ready but has no approval.json")
            approval = read_json(approval_path)
            chart = read_json(folder / 'chart.json')
            current = artifacts(folder, chart)
            for name in ('mxl', 'pdf', 'chart.json'):
                if approval['artifacts'].get(name) != current.get(name):
                    sys.exit(f"{entry['id']}: {name} changed since approval; run check + approve again")
            result.append({'book': book, 'entry': entry, 'approval': approval, 'folder': folder})
    return result


def catalog_files(charts) -> dict:
    """{path: bytes} for everything this machine publishes."""
    files = {}
    by_book = {}
    for item in charts:
        by_book.setdefault(item['book']['id'], []).append(item)
    for book_id, items in by_book.items():
        entries = []
        for item in sorted(items, key=lambda i: i['entry']['title'].lower()):
            a = item['approval']
            entry = {'id': a['id'], 'title': a['title'], 'pages': a['pages'], 'revision': a['revision'], 'assetBase': f"/samples/{book_id}/{a['id']}"}
            if a.get('composer'):
                entry['composer'] = a['composer']
            entries.append(entry)
            files[f"/samples/{book_id}/{a['id']}.mxl"] = (item['folder'] / f"{a['id']}.mxl").read_bytes()
            files[f"/samples/{book_id}/{a['id']}.pdf"] = (item['folder'] / 'source.pdf').read_bytes()
        files[f'/catalog/{book_id}.json'] = (json.dumps(entries, indent=1, ensure_ascii=False) + '\n').encode('utf-8')
    return files


def merged_index(site: str, local_books: list) -> bytes:
    """Live /catalog/books.json with this machine's books replaced; other machines' books kept."""
    live = []
    try:
        with urlopen(Request(f'https://{site}.web.app/catalog/books.json', headers={'Cache-Control': 'no-cache'}), timeout=30) as r:
            live = json.loads(r.read().decode('utf-8'))
    except Exception:
        live = []
    mine = {b['id'] for b in local_books}
    kept = [b for b in live if isinstance(b, dict) and b.get('id') not in mine]
    index = kept + [{'id': b['id'], 'title': b['title'], 'subtitle': b.get('subtitle', '')} for b in local_books]
    index.sort(key=lambda b: b['title'].lower())
    return (json.dumps(index, indent=1, ensure_ascii=False) + '\n').encode('utf-8')


def guard_paths(paths) -> None:
    for p in paths:
        if p in FORBIDDEN_PATHS or p.startswith(FORBIDDEN_PREFIXES) or not (p.startswith('/catalog/') or p.startswith('/samples/')):
            sys.exit(f'Refusing to publish {p}: only /catalog/** and /samples/<your-book>/** may be written from this pipeline')


def latest(client, site):
    releases = client.call('GET', f'{API}/sites/{site}/releases?pageSize=1').get('releases', [])
    if not releases or 'version' not in releases[0]:
        sys.exit('The site has no live release; Chris must deploy the app first')
    return releases[0]


def file_map(client, version):
    result, token = {}, ''
    while True:
        page = client.call('GET', f'{API}/{version}/files?pageSize=1000' + ('&pageToken=' + quote(token, safe='') if token else ''))
        for f in page.get('files', []):
            if f['status'] != 'ACTIVE':
                sys.exit('Live version has incomplete uploads; try again later')
            if not f['path'].startswith('/__/'):
                result[f['path']] = f['hash']
        token = page.get('nextPageToken', '')
        if not token:
            return result


def verify_http(site: str, expected: dict) -> list:
    def check(path):
        for attempt, delay in enumerate((0, 2, 4, 8, 16, 30)):
            if delay:
                time.sleep(delay)
            try:
                with urlopen(Request(f'https://{site}.web.app{path}', headers={'Cache-Control': 'no-cache'}), timeout=30) as r:
                    data = r.read()
                if sha(data) == expected[path]:
                    return {'path': path, 'sha256': sha(data), 'bytes': len(data)}
            except OSError as error:
                if getattr(error, 'code', None) == 404:
                    sys.exit(f'{path} is not on the live site yet (run publish without --verify-only)')
                if attempt == 5:
                    raise
        sys.exit('Published bytes do not match at ' + path)
    with ThreadPoolExecutor(max_workers=6) as pool:
        return list(pool.map(check, sorted(expected)))


@contextmanager
def lock():
    RECEIPTS.mkdir(parents=True, exist_ok=True)
    path = RECEIPTS / '.lock'
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        sys.exit('Another publish is running (charts/.publish/.lock exists). Wait, or delete it if nothing is running.')
    try:
        os.write(fd, str(os.getpid()).encode())
        yield
    finally:
        os.close(fd)
        path.unlink()


def cmd_publish(args) -> None:
    project, site, _ = deploy.load_config()
    charts = approved_charts(args.book)
    if not charts:
        sys.exit('Nothing approved to publish. `chart.py status` shows what is ready.')
    books = [read_json(p) for p in sorted(BOOKS.glob('*.json'))]
    if args.book:
        books = [b for b in books if b['id'] == args.book]
    files = catalog_files(charts)
    files['/catalog/books.json'] = merged_index(site, books)
    guard_paths(files)
    expected = {p: sha(b) for p, b in files.items()}
    if args.verify_only:
        print(json.dumps({'mode': 'verify-only', 'verified': verify_http(site, expected)}, indent=1))
        return
    packed = {p: gzip.compress(b, compresslevel=9, mtime=0) for p, b in files.items()}
    digests = {p: sha(g) for p, g in packed.items()}
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    report = {'started_at': stamp, 'site': site, 'charts': [c['entry']['id'] for c in charts], 'status': 'failed'}
    with lock():
        try:
            client = deploy.Client(deploy.access_token(), project)
            before = latest(client, site)
            base = before['version']['name']
            version = client.call('GET', f'{API}/{base}')
            existing = file_map(client, base)
            changes = {p: d for p, d in digests.items() if existing.get(p) != d}
            report.update(base_release=before['name'], changed_paths=sorted(changes), preserved_live_files=len(existing.keys() - changes.keys()))
            if args.dry_run:
                report['status'] = 'planned'
                return
            if not changes:
                report.update(status='unchanged', http_verified=verify_http(site, expected))
                return
            merged = {**existing, **changes}
            new = client.call('POST', f'{API}/sites/{site}/versions', {'config': version.get('config', {})})['name']
            populated = client.call('POST', f'{API}/{new}:populateFiles', {'files': merged})
            available = {digests[p]: packed[p] for p in packed}
            required = set(populated.get('uploadRequiredHashes', []))
            if not required.issubset(available):
                sys.exit('Hosting asked for bytes this machine does not have; the live version is inconsistent. Aborted before release.')
            for digest in sorted(required):
                client.call('POST', populated['uploadUrl'] + '/' + digest, available[digest])
            if latest(client, site)['name'] != before['name']:
                sys.exit('The live site changed while publishing (another publisher ran). Nothing was released; run publish again.')
            client.call('PATCH', f'{API}/{new}?updateMask=status', {'status': 'FINALIZED'})
            if file_map(client, new) != merged:
                sys.exit('The new version does not match the planned file map; not releasing it')
            if latest(client, site)['name'] != before['name']:
                sys.exit('The live site changed before release; run publish again.')
            release = client.call('POST', f'{API}/sites/{site}/releases?versionName={new}', {})
            report.update(version=new, release=release['name'], uploaded=len(required))
            report['http_verified'] = verify_http(site, {p: expected[p] for p in changes})
            report['status'] = 'published'
            for c in charts:
                c['entry']['published_revision'] = c['approval']['revision']
                c['entry']['published_at'] = now()
                save_book(c['book'])
        except SystemExit as error:
            report['error'] = str(error)
            raise
        finally:
            write_json(RECEIPTS / f'{stamp}.json', report)
            print(json.dumps({k: v for k, v in report.items() if k != 'http_verified'}, indent=1))


def cmd_status(args) -> None:
    for path in sorted(BOOKS.glob('*.json')):
        book = read_json(path)
        print(f"{book['id']}  -  {book['title']}")
        for c in book['charts']:
            pub = f"published r{c['published_revision']}" if c.get('published_revision') else 'not published'
            print(f"  {c['status']:<12} r{c.get('revision', 0)}  {c['id']:<40} {c['title']}  ({pub})")
        if not book['charts']:
            print('  (no charts yet)')
    if not list(BOOKS.glob('*.json')):
        print('No books yet. Start one with: python tools/chart/chart.py new <pdf> --book <id> --book-title "..." --title "..."')


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    subs = ap.add_subparsers(dest='command', required=True)
    p = subs.add_parser('new', help='start a chart from a PDF')
    p.add_argument('pdf'); p.add_argument('--book', required=True); p.add_argument('--title', required=True)
    p.add_argument('--composer'); p.add_argument('--pages', help='1-based page or range in the supplied PDF, e.g. 3 or 3-4')
    p.add_argument('--id'); p.add_argument('--book-title'); p.add_argument('--book-subtitle'); p.add_argument('--dpi', type=int, default=300)
    p.add_argument('--force', action='store_true'); p.set_defaults(fn=cmd_new)
    p = subs.add_parser('crop', help='enlarge a region of a source page'); p.add_argument('id'); p.add_argument('--page', type=int, default=1)
    p.add_argument('--box', required=True); p.add_argument('--dpi', type=int, default=600); p.set_defaults(fn=cmd_crop)
    p = subs.add_parser('systems', help='cut a page into staff-system strips'); p.add_argument('id'); p.add_argument('--page', type=int, default=1)
    p.add_argument('--count', type=int, required=True); p.add_argument('--top', type=float, default=0.0); p.add_argument('--bottom', type=float, default=1.0)
    p.add_argument('--dpi', type=int, default=400); p.set_defaults(fn=cmd_systems)
    p = subs.add_parser('build', help='chart.json -> MusicXML + MXL'); p.add_argument('id'); p.set_defaults(fn=cmd_build)
    p = subs.add_parser('check', help='validate and render'); p.add_argument('id'); p.add_argument('--no-render', action='store_true'); p.set_defaults(fn=cmd_check)
    p = subs.add_parser('approve', help='pin a checked, reviewed chart as ready'); p.add_argument('id'); p.add_argument('--note'); p.set_defaults(fn=cmd_approve)
    p = subs.add_parser('publish', help='push approved charts to the live catalog'); p.add_argument('--book')
    g = p.add_mutually_exclusive_group(); g.add_argument('--dry-run', action='store_true'); g.add_argument('--verify-only', action='store_true'); p.set_defaults(fn=cmd_publish)
    p = subs.add_parser('status', help='list books and charts'); p.set_defaults(fn=cmd_status)
    args = ap.parse_args()
    args.fn(args)


if __name__ == '__main__':
    main()

// The tools/chart pipeline: the fixture chart encodes, and the reader-side checker accepts it.
// Rendering is skipped here (it runs in `chart.py check`); this keeps `npm test` fast.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const fixture=path.join(root,'tools/chart/tests/fixtures/example-book-porch-light');
const python=process.platform==='win32'?'python':'python3';

test('the fixture chart encodes and passes the reader checks',t=>{
 const built=spawnSync(python,[path.join(root,'tools/chart/encoder.py'),fixture],{encoding:'utf8'});
 if(built.status!==0&&/not found|ENOENT/i.test(built.stderr||built.error?.message||''))return t.skip('python unavailable');
 assert.equal(built.status,0,built.stderr);
 const summary=JSON.parse(built.stdout);
 assert.equal(summary.measures,16);
 assert.ok(existsSync(path.join(fixture,'example-book-porch-light.mxl')));
 const checked=spawnSync(process.execPath,[path.join(root,'tools/chart/check.mjs'),fixture,'--no-render'],{encoding:'utf8'});
 const report=JSON.parse(checked.stdout.slice(checked.stdout.indexOf('{')));
 assert.deepEqual(report.failures,[]);
 assert.deepEqual(report.checks,{mxl_roundtrip:true,timing:true,ties:true,transposition:true,layout:false},'layout is only judged when rendering');
 assert.equal(report.counts.harmonies,26);
 assert.equal(report.ties_paired,2);
 assert.deepEqual({up:report.transposition['1'].fifths,down:report.transposition['-2'].fifths},{up:-6,down:-3},'F major up a semitone is engraved in G flat, down two in E flat');
});

test('a broken chart is refused before anything is written',()=>{
 const chart=JSON.parse(readFileSync(path.join(fixture,'chart.json'),'utf8'));
 chart.measures[1].notes='F4:q A4:q';
 const r=spawnSync(python,['-c',`import json,sys;sys.path.insert(0,'tools/chart');import encoder;encoder.build(json.loads(sys.stdin.read()))`],{cwd:root,input:JSON.stringify(chart),encoding:'utf8'});
 if(r.error)return;
 assert.notEqual(r.status,0);
 assert.match(r.stderr,/measure 2: notes total 24 units, expected 48/);
});

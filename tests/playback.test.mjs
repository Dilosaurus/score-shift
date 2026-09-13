import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser} from '@xmldom/xmldom';
import {parseMidi,chordPitches,harmonyPositions,planAccompaniment,noteNameToMidi,measureOnsetsFromTimemap,measureOccurrences,measureNumbers} from '../dist/playback.mjs';

const harmony=(root,kind,extra='')=>new DOMParser().parseFromString(`<harmony><root><root-step>${root[0]}</root-step>${root[1]?`<root-alter>${root[1]==='b'?-1:1}</root-alter>`:''}</root><kind>${kind}</kind>${extra}</harmony>`,'application/xml').documentElement;

test('note names map to MIDI numbers the way the soundfont names them',()=>{
 assert.equal(noteNameToMidi('C4'),60);assert.equal(noteNameToMidi('A0'),21);assert.equal(noteNameToMidi('Bb3'),58);assert.equal(noteNameToMidi('C8'),108);assert.equal(noteNameToMidi('H2'),null);
});

test('chord symbols become voiced pitches with a bass note',()=>{
 const c=chordPitches(harmony('C','major'));assert.deepEqual(c.pitches,[48,52,55]);assert.equal(c.bass,36);
 const ebmaj9=chordPitches(harmony('Eb','major-ninth'));assert.equal(ebmaj9.root,3);assert.ok(ebmaj9.pitches.every(p=>p>=48&&p<=76));assert.ok(ebmaj9.pitches.length>=4);
 const slash=chordPitches(harmony('A','minor','<bass><bass-step>D</bass-step></bass>'));assert.equal(slash.bass,36+2);assert.deepEqual(slash.pitches.map(p=>p%12).sort(),[0,4,9]);
 const sharp9=chordPitches(harmony('G','dominant','<degree><degree-value>9</degree-value><degree-alter>1</degree-alter><degree-type>add</degree-type></degree>'));assert.ok(sharp9.pitches.some(p=>p%12===(7+15)%12));
 assert.equal(chordPitches(harmony('C','none')),null);
 const unknown=chordPitches(harmony('F','minor-major-weird'));assert.deepEqual(unknown.pitches.map(p=>p%12).sort(),[0,5,8]);
});

test('harmony positions follow the note cursor, chords, backups, and offsets',()=>{
 const xml=`<score-partwise><part id="P1"><measure number="1"><attributes><divisions>2</divisions></attributes><harmony><root><root-step>C</root-step></root><kind>major</kind></harmony><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note><note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration></note><harmony><root><root-step>G</root-step></root><kind>dominant</kind></harmony><note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration></note></measure><measure number="2"><note><pitch><step>E</step><octave>4</octave></pitch><duration>8</duration></note><backup><duration>8</duration></backup><harmony><root><root-step>F</root-step></root><kind>major</kind><offset>2</offset></harmony></measure></part></score-partwise>`;
 const doc=new DOMParser().parseFromString(xml,'application/xml');
 const positions=harmonyPositions(doc);
 assert.deepEqual(positions.map(p=>[p.measure,p.beat,p.root]),[[0,0,0],[0,2,7],[1,1,5]]);
});

test('accompaniment events span until the next chord and restrike every two beats',()=>{
 const positions=[{measure:0,beat:0,pitches:[48,52,55],bass:36},{measure:0,beat:2,pitches:[43,47,50],bass:43},{measure:1,beat:0,pitches:[45,48,52],bass:45}];
 const events=planAccompaniment(positions,[{onset:0,written:0},{onset:2000,written:1}],500,4000);
 assert.deepEqual(events.map(e=>[e.time,e.dur,e.accent]),[[0,1000,true],[1000,1000,true],[2000,1000,true],[3000,1000,false]]);
 assert.deepEqual(measureOnsetsFromTimemap([{tstamp:0,measureOn:'m1'},{tstamp:500,on:['n']},{tstamp:2000,measureOn:'m2'}]),[0,2000]);
 // a repeated measure plays its chords again on the second pass
 const twice=planAccompaniment(positions,[{onset:0,written:0},{onset:2000,written:1},{onset:4000,written:0},{onset:6000,written:1}],500,8000);
 assert.deepEqual(twice.filter(e=>e.accent).map(e=>e.time),[0,1000,2000,4000,5000,6000]);
});

test('expanded repeats in the timemap map back to written measures',()=>{
 const numbers=['1','2','3','4','5'];
 const attrs={a:{n:'1',left:'rptstart'},b:{n:'2'},c:{n:'3',right:'rptend'},f:{n:'4'},g:{n:'5'}};
 const timemap=[{tstamp:0,measureOn:'a'},{tstamp:1,measureOn:'b'},{tstamp:2,measureOn:'c'},{tstamp:3,measureOn:'d'},{tstamp:4,measureOn:'e'},{tstamp:5,measureOn:'f'},{tstamp:6,measureOn:'g'}];
 const occ=measureOccurrences(timemap,id=>attrs[id],numbers);
 assert.deepEqual(occ.map(o=>[o.onset,o.written]),[[0,0],[1,1],[2,2],[3,0],[4,1],[5,3],[6,4]]);
 // repeat with a first ending: the copy skips the ending measure, so it maps from the repeat start
 const attrs2={a:{n:'1',left:'rptstart'},b:{n:'2'},c:{n:'3',right:'rptend'},z:{n:'4'}};
 const tm2=[{tstamp:0,measureOn:'a'},{tstamp:1,measureOn:'b'},{tstamp:2,measureOn:'c'},{tstamp:3,measureOn:'x'},{tstamp:4,measureOn:'y'},{tstamp:5,measureOn:'z'}];
 assert.deepEqual(measureOccurrences(tm2,id=>attrs2[id],numbers).map(o=>o.written),[0,1,2,0,1,3]);
 assert.deepEqual(measureNumbers(new DOMParser().parseFromString('<score-partwise><part id="P1"><measure number="X1"/><measure number="1"/><measure/></part></score-partwise>','application/xml')),['X1','1','3']);
});

test('a hand-built MIDI file parses into timed notes with its tempo',()=>{
 const vlq=n=>n<128?[n]:[0x80|(n>>7),n&0x7f];
 const track=[0,0xff,0x51,3,0x07,0xa1,0x20, 0,0x90,60,100, ...vlq(480),0x80,60,0, 0,0x90,64,90, ...vlq(240),0x90,64,0, 0,0xff,0x2f,0];
 const bytes=[...'MThd'].map(c=>c.charCodeAt(0)).concat([0,0,0,6,0,0,0,1,0x01,0xe0],[...'MTrk'].map(c=>c.charCodeAt(0)),[0,0,0,track.length],track);
 const midi=parseMidi(Buffer.from(bytes).toString('base64'));
 assert.equal(midi.bpm,120);assert.equal(midi.msPerQuarter,500);
 assert.deepEqual(midi.notes.map(n=>[n.pitch,Math.round(n.time),Math.round(n.dur)]),[[60,0,500],[64,500,250]]);
 assert.equal(Math.round(midi.totalMs),750);
});

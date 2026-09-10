import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {parseScore,scoreInfo,transposeScore,chooseFifths} from '../dist/music.mjs';
import createVerovioModule from 'verovio/wasm';
import {VerovioToolkit} from 'verovio/esm';
import {parseChord,addHarmony} from '../dist/chords.mjs';
const fixture=`<?xml version="1.0" encoding="utf-8"?><score-partwise version="4.0"><work><work-title>Transposition verification</work-title></work><part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions><key><fifths>-3</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><harmony><root><root-step>E</root-step><root-alter>-1</root-alter></root><kind>major-seventh</kind><bass><bass-step>B</bass-step><bass-alter>-1</bass-alter></bass></harmony><note><pitch><step>E</step><alter>-1</alter><octave>4</octave></pitch><duration>4</duration><type>quarter</type><lyric><text>Golden</text></lyric></note><note><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>D</step><octave>5</octave></pitch><duration>8</duration><type>half</type><tie type="start"/><notations><tied type="start"/></notations></note></measure><measure number="2"><note><pitch><step>D</step><octave>5</octave></pitch><duration>16</duration><type>whole</type><tie type="stop"/><notations><tied type="stop"/></notations></note><barline location="right"><bar-style>light-heavy</bar-style></barline></measure></part></score-partwise>`;
const parse=x=>parseScore(x,DOMParser),trans=(x,n,f)=>transposeScore(x,n,f,DOMParser,XMLSerializer);
const els=(d,n)=>[...d.getElementsByTagName(n)],txt=(d,n)=>els(d,n).map(x=>x.textContent);
const midi=p=>12*(Number(txt(p,'octave')[0])+1)+({C:0,D:2,E:4,F:5,G:7,A:9,B:11}[txt(p,'step')[0]])+Number(txt(p,'alter')[0]||0);
test('transposes every note, key, chord root and slash bass while preserving music structure',()=>{
 const d=parse(trans(fixture,2));assert.deepEqual(txt(d,'fifths'),['-1']);assert.deepEqual(txt(d,'root-step'),['F']);assert.deepEqual(txt(d,'bass-step'),['C']);assert.deepEqual(txt(d,'kind'),['major-seventh']);assert.deepEqual(txt(d,'step'),['F','C','E','E']);assert.deepEqual(txt(d,'octave'),['4','5','5','5']);assert.deepEqual(txt(d,'duration'),['4','4','8','16']);assert.deepEqual(txt(d,'text'),['Golden']);assert.equal(els(d,'tie').length,2);
});
test('all intervals -24..24 change each MIDI pitch by exactly the requested amount',()=>{
 const original=els(parse(fixture),'pitch').map(midi);
 for(let n=-24;n<=24;n++){const d=parse(trans(fixture,n));assert.deepEqual(els(d,'pitch').map(midi),original.map(p=>p+n));assert.equal(els(d,'harmony').length,1);}
});
test('round trip restores pitches and original key',()=>{const d=parse(trans(trans(fixture,7),-7,-3));assert.deepEqual(els(d,'pitch').map(midi),els(parse(fixture),'pitch').map(midi));assert.deepEqual(txt(d,'fifths'),['-3']);});
test('supports enharmonic target keys',()=>{const c=fixture.replace('<fifths>-3</fifths>','<fifths>0</fifths>');assert.deepEqual(txt(parse(trans(c,1,7)),'fifths'),['7']);assert.deepEqual(txt(parse(trans(c,1,-5)),'fifths'),['-5']);});
test('rejects unsafe or unsupported XML and bad intervals',()=>{assert.throws(()=>parse('<hello/>'));assert.throws(()=>parse('<!ENTITY x SYSTEM "file:///etc/passwd"><score-partwise/>'));assert.throws(()=>trans(fixture,25));assert.throws(()=>trans(fixture,1,0));});
test('real engraving engine renders original and transposed notes and harmonies',async()=>{const vrv=new VerovioToolkit(await createVerovioModule());vrv.setOptions({inputFrom:'xml',pageWidth:2100,pageHeight:2970,scale:42});assert.ok(vrv.loadData(trans(fixture,2)));const svg=vrv.renderToSVG(1);assert.match(svg,/class="note"/);assert.match(svg,/class="harm"/);assert.equal(vrv.getPageCount(),1);const mei=vrv.getMEI();assert.match(mei,/pname="f"/);assert.match(mei,/pname="c"/);assert.match(mei,/sig="1f"/);vrv.destroy();});
test('minor mode retained and spelling chosen by key',()=>{const xml=fixture.replace('<mode>major</mode>','<mode>minor</mode>');const d=parse(trans(xml,2));assert.equal(scoreInfo(d).keyName,'D minor');assert.equal(chooseFifths(-3,0),-3);});
test('missing chords can be added at a beat and transpose with the melody',()=>{const d=parse(fixture),measure=els(d,'measure')[0];addHarmony(d,measure,'Cm7/G',3,4);const result=parse(trans(new XMLSerializer().serializeToString(d),2));assert.deepEqual(txt(result,'root-step'),['F','D']);assert.deepEqual(txt(result,'bass-step'),['C','A']);assert.deepEqual(txt(result,'offset'),['8']);assert.equal(parseChord('Abmaj7').kind,'major-seventh');assert.throws(()=>parseChord('not-a-chord'));});


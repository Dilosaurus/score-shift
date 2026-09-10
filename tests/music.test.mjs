import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {parseScore,scoreInfo,transposeScore,chooseFifths} from '../dist/music.mjs';
import createVerovioModule from 'verovio/wasm';
import {VerovioToolkit} from 'verovio/esm';
import {parseChord,addHarmony} from '../dist/chords.mjs';
import {readFileSync} from 'node:fs';
import {engravingOptions,formatMusicXML,formatNotationSVG} from '../dist/engraving.mjs';
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

test('complete Golden Lady score retains every bar, chord, and modulation when transposed',()=>{
 const xml=readFileSync(new URL('../dist/samples/golden-lady-full.musicxml',import.meta.url),'utf8'),original=parse(xml);
 assert.equal(els(original,'measure').length,51);assert.equal(els(original,'pitch').length,228);assert.equal(els(original,'harmony').length,64);
 assert.deepEqual(txt(original,'fifths'),['-4','-1','-6']);
 for(const m of els(original,'measure'))assert.equal(txt(m,'duration').reduce((a,d)=>a+Number(d),0),16,`Measure ${m.getAttribute('number')}`);
 const pc=(p,prefix)=>((({C:0,D:2,E:4,F:5,G:7,A:9,B:11}[txt(p,prefix+'step')[0]])+Number(txt(p,prefix+'alter')[0]||0))%12+12)%12;
 for(const n of [-2,1,2,7,12]){
  const shifted=parse(trans(xml,n));
  assert.deepEqual(els(shifted,'pitch').map(midi),els(original,'pitch').map(p=>midi(p)+n));
  for(const name of ['root','bass'])assert.deepEqual(els(shifted,name).map(p=>pc(p,name+'-')),els(original,name).map(p=>(pc(p,name+'-')+n+12)%12));
  for(const tag of ['duration','kind','offset','degree','lyric','repeat','ending','tied','coda','segno'])assert.deepEqual(els(shifted,tag).map(e=>e.toString()),els(original,tag).map(e=>e.toString()),tag);
 }
});

test('standard notation keeps letter pages and six fixed staff rows across keys',async()=>{
 const xml=readFileSync(new URL('../dist/samples/golden-lady-full.musicxml',import.meta.url),'utf8');
 const vrv=new VerovioToolkit(await createVerovioModule());
 const byClass=(root,tag,c)=>els(root,tag).filter(e=>(' '+e.getAttribute('class')+' ').includes(' '+c+' '));
 for(const n of [-2,0,1,2,7]){
  const formatted=formatMusicXML(trans(xml,n),DOMParser,XMLSerializer),d=parse(formatted);
  assert.equal(els(d,'word-font')[0].getAttribute('font-family'),'Arial');assert.equal(els(d,'lyric-font')[0].getAttribute('font-family'),'Arial');
  assert.deepEqual(els(d,'pitch').map(midi),els(parse(xml),'pitch').map(p=>midi(p)+n));
  vrv.resetOptions();vrv.setOptions({...engravingOptions,breaks:'encoded'});assert.ok(vrv.loadData(formatted));assert.equal(vrv.getPageCount(),2);
  for(let page=1;page<=2;page++){
   const svg=new DOMParser().parseFromString(formatNotationSVG(vrv.renderToSVG(page),{fixedSystems:true,page,pageCount:2},DOMParser,XMLSerializer),'image/svg+xml');
   assert.equal(svg.documentElement.getAttribute('width'),'1080px');assert.equal(svg.documentElement.getAttribute('height'),'1397px');
   const systems=byClass(svg,'g','system');assert.equal(systems.length,6);
   systems.forEach((system,i)=>{const staff=byClass(system,'g','staff')[0],y=Number(els(staff,'path')[0].getAttribute('d').match(/^M\s*[\d.-]+[ ,]+([\d.-]+)/)[1]),shift=Number(system.getAttribute('transform').match(/translate\(0 ([\d.-]+)\)/)[1]);assert.equal(y+shift,2800+i*4100);});
   for(const text of els(svg,'text'))assert.equal(text.getAttribute('font-family'),'Arial, sans-serif');
  }
 }
 vrv.destroy();
});


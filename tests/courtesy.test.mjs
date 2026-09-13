import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import createVerovioModule from 'verovio/wasm';
import {VerovioToolkit} from 'verovio/esm';
import {parseScore,transposeScore} from '../dist/music.mjs';

const els=(el,tag)=>[...el.getElementsByTagName(tag)];
const n=(alter=0,extra='',octave=4,staff=1)=>`<note><pitch><step>F</step><alter>${alter}</alter><octave>${octave}</octave></pitch><duration>4</duration>${extra}<type>quarter</type><staff>${staff}</staff></note>`;
const key=fifths=>`<key><fifths>${fifths}</fifths></key>`;
const score=(bars,fifths=0)=>`<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Courtesy accidentals</part-name></score-part></part-list><part id="P1">${bars.map((bar,i)=>`<measure number="${i+1}">${i?'':`<attributes><divisions>4</divisions>${key(fifths)}<time><beats>1</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`}${bar}</measure>`).join('')}</part></score-partwise>`;
const trans=(xml,semitones=0)=>transposeScore(xml,semitones,undefined,DOMParser,XMLSerializer);
const parse=xml=>parseScore(xml,DOMParser);
const marks=xml=>els(parse(xml),'note').map(note=>{
 const acc=els(note,'accidental')[0];return acc?{name:acc.textContent,courtesy:acc.getAttribute('cautionary')==='yes',parentheses:acc.getAttribute('parentheses')==='yes'}:null;
});
const natural={name:'natural',courtesy:true,parentheses:true};

test('adds one natural reminder after a chromatic note, even in the original key',()=>{
 const xml=score([n(1),n()+n(),n()]),result=trans(xml);
 assert.deepEqual(marks(result),[{name:'sharp',courtesy:false,parentheses:false},natural,null,null]);
 assert.deepEqual(els(parse(result),'pitch').map(String),els(parse(xml),'pitch').map(String));
 assert.equal(trans(result),result,'repeated rendering must not accumulate marks');
});

test('restores key-signature sharps and flats, including after transposition',()=>{
 assert.deepEqual(marks(trans(score([n(),n(1)],1)))[1],{name:'sharp',courtesy:true,parentheses:true});
 const xml=score([n(1),n()]);
 assert.deepEqual(marks(trans(xml,1))[1],{name:'flat',courtesy:true,parentheses:true});
 assert.deepEqual(marks(trans(xml,2))[1],natural);
 assert.deepEqual(marks(trans(xml,-1))[1],natural);
});

test('preserves source courtesy attributes and transposes their displayed symbol',()=>{
 const xml=score([n().replace('<type>','<accidental cautionary="yes" parentheses="yes" size="cue">natural</accidental><type>')]);
 for(const [interval,name] of [[0,'natural'],[1,'flat'],[2,'natural']]){
  const acc=els(parse(trans(xml,interval)),'accidental')[0];
  assert.equal(acc.textContent,name);assert.equal(acc.getAttribute('cautionary'),'yes');
  assert.equal(acc.getAttribute('parentheses'),'yes');assert.equal(acc.getAttribute('size'),'cue');
 }
});

test('mandatory in-bar cancellation stays plain; no reminder after a rest bar or already-cancelled pitch',()=>{
 assert.deepEqual(marks(trans(score([n(1)+n(),n()]))),[
  {name:'sharp',courtesy:false,parentheses:false},{name:'natural',courtesy:false,parentheses:false},null]);
 assert.equal(marks(trans(score([n(1),'<note><rest/><duration>4</duration><type>quarter</type></note>',n()]))).at(-1),null);
});

test('courtesy memory is separate for each octave and staff',()=>{
 assert.equal(marks(trans(score([n(1),n(0,'',5)])))[1],null);
 assert.equal(marks(trans(score([n(1),n(0,'',4,2)])))[1],null);
});

test('uses musical time across backup voices, not XML order',()=>{
 const xml=score([n(1)+n()+'<backup><duration>8</duration></backup>'+n(1),n()]);
 assert.equal(marks(trans(xml)).at(-1),null,'the final sounding F in bar one is natural');
});

test('key changes reset reminders, while repeated unchanged key signatures do not',()=>{
 assert.equal(marks(trans(score([n(1),`<attributes>${key(1)}</attributes>`+n(1)])))[1],null);
 assert.deepEqual(marks(trans(score([n(1),`<attributes>${key(0)}</attributes>`+n()])))[1],natural);
});

test('ties do not get automatic reminders or suppress necessary new-attack accidentals',()=>{
 const tie='<tie type="stop"/>';
 assert.deepEqual(marks(trans(score([n(1,'<tie type="start"/>'),n(1,tie)+n(1)]))),[
  {name:'sharp',courtesy:false,parentheses:false},null,{name:'sharp',courtesy:false,parentheses:false}]);
 assert.deepEqual(marks(trans(score([n(1,'<tie type="start"/>'),n(1,tie)+n()]))).at(-1),natural);
 assert.deepEqual(marks(trans(score([n(1,'<tie type="start"/>'),n(1,tie),n()]))).at(-1),natural);
});

test('a global key change resets a formerly staff-specific accidental state',()=>{
 const xml=score([`<attributes><key number="2"><fifths>1</fifths></key></attributes>`+n(1,'',4,2)+`<attributes>${key(0)}</attributes>`+n(0,'',4,2)]);
 assert.deepEqual(marks(trans(xml)),[null,null]);
});

test('Verovio engraves the generated courtesy and both parentheses',async()=>{
 const vrv=new VerovioToolkit(await createVerovioModule());
 try{
  vrv.setOptions({inputFrom:'xml'});assert.ok(vrv.loadData(trans(score([n(1),n()]))));
  const mei=new DOMParser().parseFromString(vrv.getMEI(),'application/xml');
  const note=els(mei,'note')[1],acc=els(note,'accid')[0];
  assert.equal(acc.getAttribute('accid'),'n');assert.equal(acc.getAttribute('enclose'),'paren');
  const svg=vrv.renderToSVG(1);
  assert.match(svg,/E26A/);assert.match(svg,/E26B/);
 }finally{vrv.destroy();}
});

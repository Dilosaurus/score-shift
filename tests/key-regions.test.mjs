import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {parseScore,transposeScore} from '../dist/music.mjs';

const els=(el,tag)=>[...el.getElementsByTagName(tag)];
const txt=(el,tag)=>els(el,tag)[0]?.textContent;
const pc={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
const midi=p=>12*(Number(txt(p,'octave'))+1)+pc[txt(p,'step')]+Number(txt(p,'alter')||0);
const spelling=p=>txt(p,'step')+':'+(txt(p,'alter')||'0')+':'+txt(p,'octave');
const pitchClass=(p,prefix)=>(pc[txt(p,prefix+'step')]+Number(txt(p,prefix+'alter')||0)+12)%12;
const parse=x=>parseScore(x,DOMParser);
const trans=(x,n,target)=>parse(transposeScore(x,n,target,DOMParser,XMLSerializer));
const key=(fifths,staff='')=>`<key${staff?` number="${staff}"`:''}><fifths>${fifths}</fifths></key>`;
const attributes=(keys,divisions=4)=>`<attributes><divisions>${divisions}</divisions>${keys}</attributes>`;
function note(step,alter=0,{octave=4,duration=4,type='quarter',staff=1,voice=1,ties=[],accidental='',chord=false,grace=false}={}){
 return`<note>${grace?'<grace/>':''}${chord?'<chord/>':''}<pitch><step>${step}</step>${alter?`<alter>${alter}</alter>`:''}<octave>${octave}</octave></pitch>${grace?'':`<duration>${duration}</duration>`}${ties.map(type=>`<tie type="${type}"/>`).join('')}<voice>${voice}</voice><type>${type}</type>${accidental}<staff>${staff}</staff>${ties.length?`<notations>${ties.map(type=>`<tied type="${type}"/>`).join('')}</notations>`:''}</note>`;
}
function harmony(id,step,alter=0,{bass='F',bassAlter=1,offset=0,staff=1}={}){
 return`<harmony id="${id}"><root><root-step>${step}</root-step>${alter?`<root-alter>${alter}</root-alter>`:''}</root><kind text="maj7">major-seventh</kind><bass><bass-step>${bass}</bass-step>${bassAlter?`<bass-alter>${bassAlter}</bass-alter>`:''}</bass><degree print-object="no"><degree-value>9</degree-value><degree-alter>0</degree-alter><degree-type>add</degree-type></degree><offset>${offset}</offset><staff>${staff}</staff></harmony>`;
}
const score=parts=>`<score-partwise version="4.0"><part-list>${parts.map((_,i)=>`<score-part id="P${i+1}"><part-name>Part ${i+1}</part-name></score-part>`).join('')}</part-list>${parts.map((bars,i)=>`<part id="P${i+1}">${bars.map((bar,j)=>`<measure number="${j+1}">${bar}</measure>`).join('')}</part>`).join('')}</score-partwise>`;
function invariants(original,result,n){
 const source=parse(original);
 assert.deepEqual(els(result,'pitch').map(midi),els(source,'pitch').map(p=>midi(p)+n));
 for(const tag of ['root','bass'])assert.deepEqual(els(result,tag).map(p=>pitchClass(p,tag+'-')),els(source,tag).map(p=>(pitchClass(p,tag+'-')+n+24)%12));
 for(const tag of ['duration','type','dot','voice','staff','offset','kind','degree','lyric','repeat','ending','barline','tie','tied','time-modification','beam','rest','backup','forward','grace','chord'])assert.deepEqual(els(result,tag).map(String),els(source,tag).map(String),tag);
}

// The source chart's Db -> D -> Db progression previously became +5/+12/+5
// at -2, or +2/+9/+2 at +1, although its sounding pitches still passed.
test('Body and Soul key regions get practical keys and matching notes, roots and basses',()=>{
 const xml=score([[
  attributes(key(-5))+harmony('outer1','D',-1)+note('D',-1,{duration:16,type:'whole'})+'<barline><repeat direction="forward"/></barline>',
  attributes(key(2))+harmony('bridge','D')+note('D',0,{duration:16,type:'whole'}),
  attributes(key(-5))+harmony('outer2','D',-1)+note('D',-1,{duration:16,type:'whole'})+'<barline><ending number="1" type="stop"/><repeat direction="backward"/></barline>'
 ]]);
 for(const [n,keys,notes] of [[-2,[5,0,5],['B:0:3','C:0:4','B:0:3']],[1,[2,-3,2],['D:0:4','E:-1:4','D:0:4']],[0,[-5,2,-5],['D:-1:4','D:0:4','D:-1:4']]]){
  const d=trans(xml,n);assert.deepEqual(els(d,'fifths').map(x=>Number(x.textContent)),keys);assert.deepEqual(els(d,'pitch').map(spelling),notes);invariants(xml,d,n);
  const h=els(d,'harmony')[1];assert.equal(txt(h,'root-step'),n===-2?'C':n===1?'E':'D');assert.equal(txt(h,'bass-step'),n===-2?'E':n===1?'G':'F');
 }
});

test('an explicit enharmonic initial target survives normalization and the return to that key',()=>{
 const xml=score([[attributes(key(0))+note('C'),attributes(key(2))+note('D'),attributes(key(0))+note('C')]]);
 const d=trans(xml,1,7);assert.deepEqual(els(d,'fifths').map(x=>x.textContent),['7','-3','7']);
 assert.deepEqual(els(d,'pitch').map(spelling),['C:1:4','E:-1:4','C:1:4']);invariants(xml,d,1);
 assert.throws(()=>trans(xml,1,0),/Target key/);
});

test('part and staff keys are independent, and a global change clears staff overrides',()=>{
 const xml=score([[
  attributes(key(-5)+key(2,2))+harmony('staff1','D',-1)+note('D',-1,{duration:16,type:'whole'})+'<backup><duration>16</duration></backup>'+harmony('staff2','D',0,{staff:2})+note('D',0,{duration:16,type:'whole',staff:2,voice:2}),
  attributes(key(-5))+note('D',-1,{duration:16,type:'whole',staff:2,voice:2})
 ],[attributes(key(2))+harmony('part2','D')+note('D',0,{duration:16,type:'whole'})],[attributes('')+note('C',0,{duration:16,type:'whole'})]]);
 const d=trans(xml,-2);assert.deepEqual(els(d,'fifths').map(x=>x.textContent),['5','0','5','0']);
 assert.deepEqual(els(d,'pitch').map(spelling),['B:0:3','C:0:4','B:0:3','C:0:4','B:-1:3']);invariants(xml,d,-2);
 assert.deepEqual(els(d,'root-step').map(x=>x.textContent),['B','C','C']);
});

test('rational onsets, changed divisions and signed harmony offsets choose the actual key region',()=>{
 const xml=score([[
  attributes(key(-5),3)+harmony('future-key','D',0,{offset:2})+harmony('early','D',-1,{offset:1})+harmony('next-bar','D',-1,{offset:3})+
  note('D',-1,{duration:2})+attributes(key(2),6)+note('D',0,{duration:2})+
  '<backup><duration>6</duration></backup>'+harmony('after-backup','D',-1,{offset:3})+note('D',-1,{duration:4,voice:2})+note('D',0,{duration:2,voice:2})+harmony('negative','D',-1,{offset:-3}),
  attributes(key(-5),6)+harmony('prior-bar','D',0,{offset:-1})+note('D',-1,{duration:6})
 ]]);
 const d=trans(xml,-2);invariants(xml,d,-2);
 assert.deepEqual(els(d,'pitch').map(spelling),['B:0:3','C:0:4','B:0:3','C:0:4','B:0:3']);
 assert.deepEqual(els(d,'harmony').map(h=>[h.getAttribute('id'),txt(h,'root-step')]),[['future-key','C'],['early','B'],['next-bar','B'],['after-backup','B'],['negative','B'],['prior-bar','C']]);
});

test('chord and grace notes use their real onset after a backup, not the current XML key',()=>{
 const xml=score([[attributes(key(-5))+note('D',-1)+attributes(key(2))+note('D')+'<backup><duration>8</duration></backup>'+note('D',-1,{voice:2})+note('F',0,{voice:2,chord:true})+note('D',0,{voice:2,grace:true,type:'eighth'})+note('D',0,{voice:2})+'<forward><duration>4</duration></forward>'+attributes(key(-5))+note('D',-1,{voice:2})]]);
 const d=trans(xml,-2);assert.deepEqual(els(d,'pitch').map(spelling),['B:0:3','C:0:4','B:0:3','D:1:4','C:0:4','C:0:4','B:0:3']);invariants(xml,d,-2);
});

test('ties retain attack spelling across a modulation while new attacks and other voices use the new key',()=>{
 const acc='<accidental cautionary="yes" parentheses="yes" bracket="yes" size="cue">natural</accidental>';
 const xml=score([[
  attributes(key(-5))+note('D',0,{octave:5,ties:['start'],accidental:acc}),
  attributes(key(2))+note('D',0,{octave:5,ties:['stop','start'],accidental:acc})+'<backup><duration>4</duration></backup>'+note('D',0,{octave:5,voice:2}),
  note('D',0,{octave:5,ties:['stop']})+note('D',0,{octave:5,accidental:acc})
 ]]);
 const d=trans(xml,1);assert.deepEqual(els(d,'pitch').map(spelling),['D:1:5','D:1:5','E:-1:5','D:1:5','E:-1:5']);invariants(xml,d,1);
 const marked=els(d,'note').filter(n=>els(n,'accidental').length);
 assert.deepEqual(marked.map(n=>txt(n,'accidental')),['sharp','sharp','flat']);
 for(const n of marked)for(const [attr,v] of [['cautionary','yes'],['parentheses','yes'],['bracket','yes'],['size','cue']])assert.equal(els(n,'accidental')[0].getAttribute(attr),v);
 const again=trans(new XMLSerializer().serializeToString(d),0);assert.deepEqual(els(again,'pitch').map(String),els(d,'pitch').map(String));assert.deepEqual(els(again,'accidental').map(String),els(d,'accidental').map(String));
});

test('decimal divisions and unequal decimal sums land exactly on a key boundary',()=>{
 const xml=score([[attributes(key(-5),' 10.0 ')+note('D',-1,{duration:' 1.0 '})+note('D',-1,{duration:1})+note('D',-1,{duration:1})+attributes(key(2),10)+note('D',0,{duration:7})+'<backup><duration>10</duration></backup>'+note('D',-1,{duration:3,voice:2})+note('D',0,{duration:7,voice:2})]]);
 const d=trans(xml,-2);assert.deepEqual(els(d,'pitch').map(spelling),['B:0:3','B:0:3','B:0:3','C:0:4','B:0:3','C:0:4']);invariants(xml,d,-2);
 assert.equal(els(d,'accidental').length,0,'courtesy refresh must see both voices at the exact same new-key onset');
});

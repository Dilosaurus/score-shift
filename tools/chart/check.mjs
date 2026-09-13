// Checks a chart folder the way the ScoreShift reader will actually use it, then renders review
// pages. Run by `python tools/chart/chart.py check <id>`; prints one JSON report on stdout.
//
//   node tools/chart/check.mjs charts/<book>/<id> [--no-render]
//
// Checks: the MXL unpacks to the exact MusicXML; every measure's voices add up; chord offsets
// stay inside their bar; ties pair up; transposition by -2 / 0 / +1 semitones moves every pitch,
// chord root and slash bass by exactly that amount and changes nothing else; and Verovio engraves
// every key through the reader's pipeline onto no more pages than the scan had. Renders land in
// renders/key-<n>-page-<p>.png for the person (or assistant) to compare against the scan.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {unzipSync,strFromU8} from 'fflate';
import create from 'verovio/wasm';
import {VerovioToolkit} from 'verovio/esm';
import sharp from 'sharp';
import {parseScore,scoreInfo,transposeScore} from '../../dist/music.mjs';
import {formatMusicXML,formatNotationSVG,engravingOptions} from '../../dist/engraving.mjs';
import {baseOptions,fitLayout} from '../../dist/layout.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
const folder=path.resolve(process.argv[2]||'');
const render=!process.argv.includes('--no-render');
const KEYS=[-2,0,1];
const hash=b=>createHash('sha256').update(b).digest('hex');
const els=(n,t)=>[...n.getElementsByTagName(t)];
const val=(n,t)=>els(n,t)[0]?.textContent;
const pc={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
const midi=n=>12*(Number(val(n,'octave'))+1)+pc[val(n,'step')]+Number(val(n,'alter')||0);
const kids=n=>[...n.childNodes].filter(c=>c.nodeType===1);
const failures=[];
const fail=(check,message)=>failures.push({check,message});

const chart=JSON.parse(await fs.readFile(path.join(folder,'chart.json'),'utf8'));
const xmlBytes=await fs.readFile(path.join(folder,chart.id+'.musicxml'));
const mxlBytes=await fs.readFile(path.join(folder,chart.id+'.mxl'));
const xml=xmlBytes.toString('utf8');

// 1. MXL round trip.
let roundtrip=false;
try{
 const archive=unzipSync(new Uint8Array(mxlBytes));
 const container=new DOMParser().parseFromString(strFromU8(archive['META-INF/container.xml']),'application/xml');
 const root=container.getElementsByTagName('rootfile')[0].getAttribute('full-path');
 roundtrip=root===chart.id+'.musicxml'&&strFromU8(archive[root])===xml&&strFromU8(archive['mimetype'])==='application/vnd.recordare.musicxml';
}catch(e){fail('mxl_roundtrip',e.message);}
if(!roundtrip)fail('mxl_roundtrip','the MXL does not contain the exact MusicXML');

// 2. Structure + timing per voice.
const doc=parseScore(xml,DOMParser);
const info=scoreInfo(doc);
const measures=els(doc,'measure');
if(measures.length!==chart.measures.length)fail('timing',`MusicXML has ${measures.length} measures, chart.json has ${chart.measures.length}`);
const divisions=Number(val(doc,'divisions'));
let beats=4,beatType=4,tieOpen=new Map(),tiesPaired=0;
const counts={measures:measures.length,notes:els(doc,'pitch').length,rests:els(doc,'rest').length,slashes:els(doc,'unpitched').length,
 harmonies:els(doc,'harmony').length,slash_basses:els(doc,'bass').length,tuplets:els(doc,'time-modification').length,
 lyrics:els(doc,'lyric').length,accidentals:els(doc,'accidental').length,repeats:els(doc,'repeat').length,endings:els(doc,'ending').length};
measures.forEach((m,i)=>{
 const time=els(m,'time')[0];if(time){beats=Number(val(time,'beats'));beatType=Number(val(time,'beat-type'));}
 const expected=divisions*beats*4/beatType,spec=chart.measures[i]||{};
 let cursor=0,high=0;const ends={};
 for(const child of kids(m)){
  const duration=Number(val(child,'duration')||0),voice=val(child,'voice')||'1';
  if(child.tagName==='harmony'||child.tagName==='direction'){
   const at=cursor+Number(val(child,'offset')||0);
   if(child.tagName==='harmony'&&(at<0||at>=expected))fail('timing',`measure ${i+1}: chord at offset ${at} is outside the bar`);
  }
  if(child.tagName==='backup')cursor-=duration;
  if(child.tagName==='forward')cursor+=duration;
  if(child.tagName==='note'){
   if(!els(child,'grace').length){cursor+=duration;ends[voice]=cursor;}
   const p=els(child,'pitch')[0];
   if(p){const key=midi(p);const ties=els(child,'tie').map(t=>t.getAttribute('type'));
    if(ties.includes('stop')){if(tieOpen.get(key)){tieOpen.delete(key);tiesPaired++;}else fail('ties',`measure ${i+1}: tie ends on ${val(p,'step')}${val(p,'octave')} with no tie start`);}
    if(ties.includes('start')){if(tieOpen.get(key))fail('ties',`measure ${i+1}: tie starts twice on the same pitch`);tieOpen.set(key,i+1);}
   }
  }
  high=Math.max(high,cursor);
  if(cursor<0)fail('timing',`measure ${i+1}: backup runs before the bar`);
 }
 const implicit=m.getAttribute('implicit')==='yes'||spec.short;
 if(implicit?high>expected||high<=0:high!==expected)fail('timing',`measure ${i+1}: bar holds ${high} of ${expected} units`);
 for(const [voice,end] of Object.entries(ends))if(end!==high)fail('timing',`measure ${i+1}: voice ${voice} ends at ${end}, bar ends at ${high}`);
});
if(tieOpen.size)fail('ties',`ties never closed: ${[...tieOpen.values()].map(m=>'measure '+m).join(', ')}`);

// 3. Transposition: every pitch, root and bass moves by n; everything else stays put.
function fingerprint(d){
 return {durations:els(d,'note').map(n=>val(n,'duration')||'g'),types:els(d,'type').map(t=>t.textContent),
  lyrics:els(d,'text').map(t=>t.textContent),kinds:els(d,'kind').map(k=>k.getAttribute('text')||k.textContent),
  measures:els(d,'measure').length,harmonies:els(d,'harmony').length,notes:els(d,'note').length};
}
const original=fingerprint(doc);
const transposition={};
for(const semitones of KEYS){
 try{
  const t=parseScore(transposeScore(xml,semitones,undefined,DOMParser,XMLSerializer),DOMParser);
  const a=els(doc,'pitch'),b=els(t,'pitch');
  if(a.length!==b.length)fail('transposition',`${semitones}: pitch count changed`);
  a.forEach((p,i)=>{if(b[i]&&midi(b[i])-midi(p)!==semitones)fail('transposition',`${semitones}: a note moved ${midi(b[i])-midi(p)} semitones`);});
  for(const part of ['root','bass']){
   const ra=els(doc,part),rb=els(t,part);
   ra.forEach((r,i)=>{const from=(pc[val(r,part+'-step')]+Number(val(r,part+'-alter')||0)+24)%12,to=(pc[val(rb[i],part+'-step')]+Number(val(rb[i],part+'-alter')||0)+24)%12;
    if((to-from+24)%12!==(semitones+24)%12)fail('transposition',`${semitones}: a chord ${part} moved wrong`);});
  }
  const f=fingerprint(t);
  for(const k of Object.keys(original))if(JSON.stringify(f[k])!==JSON.stringify(original[k]))fail('transposition',`${semitones}: ${k} changed`);
  transposition[semitones]={fifths:Number(val(t,'fifths')),ok:true};
 }catch(e){fail('transposition',`${semitones}: ${e.message}`);}
}

// 4. Engrave every key through the reader pipeline; fit onto the scan's page count.
const renders=[];let pages={};
if(render){
 await fs.mkdir(path.join(folder,'renders'),{recursive:true});
 const toolkit=new VerovioToolkit(await create());
 const target=Number.isInteger(chart.source?.pages)&&chart.source.pages>0?chart.source.pages:1;
 const score={info,pages:target};
 const warnings=[];
 for(const semitones of KEYS){
  const transformed=transposeScore(xml,semitones,undefined,DOMParser,XMLSerializer);
  const d=parseScore(formatMusicXML(transformed,DOMParser,XMLSerializer),DOMParser);
  for(const degree of els(d,'degree'))if(degree.getAttribute('print-object')==='no')degree.parentNode.removeChild(degree);
  const data=new XMLSerializer().serializeToString(d);
  const base=baseOptions(engravingOptions,score);
  const measure=options=>{toolkit.resetOptions();toolkit.setOptions(options);if(!toolkit.loadData(data))throw Error('Verovio could not load the score');return toolkit.getPageCount();};
  const fit=fitLayout(base,target,measure);
  toolkit.resetOptions();toolkit.setOptions(fit.options);toolkit.loadData(data);
  const log=toolkit.getLog();if(log&&log.trim())warnings.push({semitones,log:log.trim().slice(0,800)});
  const count=toolkit.getPageCount();pages[semitones]={pages:count,scale:fit.scale,fits:fit.fits};
  if(!fit.fits)fail('layout',`${semitones}: needs ${count} pages, the scan has ${target}`);
  for(let p=1;p<=count;p++){
   const svg=formatNotationSVG(toolkit.renderToSVG(p,{}),{},DOMParser,XMLSerializer);
   const stem=path.join(folder,'renders',`key-${semitones}-page-${p}`);
   await fs.writeFile(stem+'.svg',svg);
   const png=await sharp(Buffer.from(svg),{density:96}).resize({width:1240}).flatten({background:'#ffffff'}).png().toBuffer();
   await fs.writeFile(stem+'.png',png);
   renders.push({semitones,page:p,png:path.relative(folder,stem+'.png').replaceAll('\\','/'),sha256:hash(png)});
  }
 }
 if(warnings.length)pages.verovio_log=warnings;
}

const report={id:chart.id,checked_at:new Date().toISOString(),inputs:{'chart.json':hash(await fs.readFile(path.join(folder,'chart.json'))),musicxml:hash(xmlBytes),mxl:hash(mxlBytes)},
 counts,info:{measures:info.measures,notes:info.notes,chords:info.chords,fifths:info.fifths,layout:info.layout},ties_paired:tiesPaired,transposition,pages,renders,
 checks:{mxl_roundtrip:!failures.some(f=>f.check==='mxl_roundtrip'),timing:!failures.some(f=>f.check==='timing'),ties:!failures.some(f=>f.check==='ties'),
  transposition:!failures.some(f=>f.check==='transposition'),layout:render&&!failures.some(f=>f.check==='layout')},failures};
report.ok=Object.values(report.checks).every(Boolean);
console.log(JSON.stringify(report,null,1));
process.exit(report.ok?0:1);

// Playback: melody from Verovio's MIDI, comping piano + bass generated from the chart's chord
// symbols, scheduled on Web Audio with sampled piano and bass. Pure helpers (parseMidi,
// chordPitches, harmonyEvents, planAccompaniment) are exported for tests; createPlayer needs a browser.
const STEP={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
const DEGREE={1:0,2:2,3:4,4:5,5:7,6:9,7:10,9:14,11:17,13:21};
const KINDS={major:[0,4,7],minor:[0,3,7],augmented:[0,4,8],diminished:[0,3,6],dominant:[0,4,7,10],'major-seventh':[0,4,7,11],'minor-seventh':[0,3,7,10],'diminished-seventh':[0,3,6,9],'augmented-seventh':[0,4,8,10],'half-diminished':[0,3,6,10],'major-minor':[0,3,7,11],'major-sixth':[0,4,7,9],'minor-sixth':[0,3,7,9],'dominant-ninth':[0,4,7,10,14],'major-ninth':[0,4,7,11,14],'minor-ninth':[0,3,7,10,14],'dominant-11th':[0,4,7,10,14,17],'major-11th':[0,4,7,11,14,17],'minor-11th':[0,3,7,10,14,17],'dominant-13th':[0,4,7,10,14,21],'major-13th':[0,4,7,11,14,21],'minor-13th':[0,3,7,10,14,21],'suspended-second':[0,2,7],'suspended-fourth':[0,5,7],power:[0,7],pedal:[0],Tristan:[0,6,10,15],Neapolitan:[0,1,5],Italian:[0,4,10],French:[0,4,6,10],German:[0,4,7,10]};
export function noteNameToMidi(name){const m=/^([A-G])(b|#)?(-?\d)$/.exec(name);if(!m)return null;return(Number(m[3])+1)*12+STEP[m[1]]+(m[2]==='b'?-1:m[2]==='#'?1:0);}
function text(el,tag){return el?.getElementsByTagName(tag)[0]?.textContent?.trim();}
function pitchClass(el,stepTag,alterTag){const step=text(el,stepTag);if(!step||STEP[step]===undefined)return null;return(STEP[step]+Number(text(el,alterTag)||0)+120)%12;}
// Chord tones for a MusicXML <harmony>: root + kind + degree alterations, voiced in a comfortable register.
export function chordPitches(harmony){
 const root=harmony.getElementsByTagName('root')[0];const rootPc=pitchClass(root,'root-step','root-alter');if(rootPc===null)return null;
 const kindEl=harmony.getElementsByTagName('kind')[0],kind=(kindEl?.textContent||'major').trim();if(kind==='none')return null;
 let intervals=[...(KINDS[kind]||(kind.includes('minor')?[0,3,7]:kind.includes('dominant')?[0,4,7,10]:[0,4,7]))];
 for(const degree of harmony.getElementsByTagName('degree')){const value=Number(text(degree,'degree-value')),alter=Number(text(degree,'degree-alter')||0),type=text(degree,'degree-type')||'add';if(!DEGREE[value]&&value!==7)continue;const semis=(DEGREE[value]??10)+alter;const base=DEGREE[value]??10;if(type==='subtract')intervals=intervals.filter(i=>i%12!==base%12);else if(type==='alter'){intervals=intervals.filter(i=>i%12!==base%12);intervals.push(semis);}else intervals.push(semis);}
 intervals=[...new Set(intervals)].sort((a,b)=>a-b);
 const rootMidi=48+rootPc;let pitches=intervals.map(i=>rootMidi+i);
 if(intervals.length>4)pitches=pitches.filter((p,i)=>i!==0||intervals.length<=5);
 pitches=pitches.map(p=>p>76?p-12:p).sort((a,b)=>a-b);
 const bassEl=harmony.getElementsByTagName('bass')[0],bassPc=bassEl?pitchClass(bassEl,'bass-step','bass-alter'):null;
 return{pitches:[...new Set(pitches)],bass:36+(bassPc??rootPc),root:rootPc,kind};
}
// Where every chord symbol falls, in quarter-note beats from the start of its measure.
export function harmonyPositions(doc){
 const part=doc.getElementsByTagName('part')[0];if(!part)return[];
 const kids=el=>[...el.childNodes].filter(n=>n.nodeType===1);
 const measures=kids(part).filter(el=>el.tagName==='measure');let divisions=1;const out=[];
 measures.forEach((measure,index)=>{
  let cursor=0,length=0;
  for(const el of kids(measure)){
   switch(el.tagName){
    case 'attributes':{const d=text(el,'divisions');if(d)divisions=Number(d)||divisions;break;}
    case 'note':{if(el.getElementsByTagName('grace').length||el.getElementsByTagName('chord').length)break;cursor+=Number(text(el,'duration')||0);length=Math.max(length,cursor);break;}
    case 'backup':cursor-=Number(text(el,'duration')||0);break;
    case 'forward':cursor+=Number(text(el,'duration')||0);length=Math.max(length,cursor);break;
    case 'harmony':{const chord=chordPitches(el);if(!chord)break;const offset=Number(text(el,'offset')||0);out.push({measure:index,beat:Math.max(0,(cursor+offset)/divisions),...chord});break;}
   }
  }
 });
 return out;
}
export function measureNumbers(doc){const part=doc.getElementsByTagName('part')[0];if(!part)return[];return[...part.childNodes].filter(n=>n.nodeType===1&&n.tagName==='measure').map((m,i)=>m.getAttribute('number')||String(i+1));}
// Verovio's timemap expands repeat barlines, so a chart of 51 written measures may play 98. Numbered
// entries map straight to written measures; the unnumbered copies that follow a repeat map back to the
// repeated span (from the last rptstart measure), so chords line up on every pass.
export function measureOccurrences(timemap,attrOf,numbers){
 const out=[];let repeatStart=0,last=-1,pending=[];
 const flush=()=>{if(!pending.length)return;const k=pending.length;let start=repeatStart;if(last-start+1<k)start=Math.max(0,last-k+1);pending.forEach((t,j)=>out.push({onset:t,written:Math.min(numbers.length-1,start+j)}));pending=[];};
 for(const e of timemap){
  if(!e.measureOn)continue;const a=attrOf(e.measureOn)||{};const idx=a.n!==undefined?numbers.indexOf(String(a.n)):-1;
  if(idx>=0){flush();if(a.left==='rptstart')repeatStart=idx;out.push({onset:e.tstamp,written:idx});last=idx;}
  else pending.push(e.tstamp);
 }
 flush();return out;
}
// Turn chord positions into timed comping + bass events, once per played occurrence of each written measure.
export function planAccompaniment(positions,occurrences,msPerQuarter,endMs){
 const byMeasure=new Map();for(const p of positions){if(!byMeasure.has(p.measure))byMeasure.set(p.measure,[]);byMeasure.get(p.measure).push(p);}
 const seq=[];for(const occ of occurrences)for(const p of byMeasure.get(occ.written)||[])seq.push({time:occ.onset+p.beat*msPerQuarter,pitches:p.pitches,bass:p.bass});
 seq.sort((a,b)=>a.time-b.time);
 const events=[],stride=msPerQuarter*2;
 seq.forEach((c,i)=>{
  const end=Math.min(seq[i+1]?.time??endMs,endMs);if(end<=c.time)return;const span=end-c.time;
  for(let t=c.time;t<end-1;t+=stride){events.push({time:t,dur:Math.min(stride,end-t),pitches:c.pitches,bass:c.bass,accent:t===c.time});if(span<=stride)break;}
 });
 return events;
}
// Minimal Standard MIDI File reader: notes (ms), tempo, length.
export function parseMidi(base64){
 const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));const view=new DataView(bytes.buffer);let pos=0;
 const str=n=>{const s=String.fromCharCode(...bytes.subarray(pos,pos+n));pos+=n;return s;};const u32=()=>{const v=view.getUint32(pos);pos+=4;return v;};const u16=()=>{const v=view.getUint16(pos);pos+=2;return v;};
 const vlq=()=>{let v=0,b;do{b=bytes[pos++];v=(v<<7)|(b&0x7f);}while(b&0x80);return v;};
 if(str(4)!=='MThd')throw Error('Not a MIDI file');const headerLength=u32();u16();const tracks=u16(),division=u16();pos+=headerLength-6;
 const tempos=[],raw=[];
 for(let t=0;t<tracks;t++){
  if(str(4)!=='MTrk')throw Error('Bad MIDI track');const length=u32(),end=pos+length;let tick=0,status=0;const open=new Map();
  while(pos<end){
   tick+=vlq();let b=bytes[pos];
   if(b===0xff){pos++;const type=bytes[pos++],len=vlq();if(type===0x51)tempos.push({tick,usPerQuarter:(bytes[pos]<<16)|(bytes[pos+1]<<8)|bytes[pos+2]});pos+=len;continue;}
   if(b===0xf0||b===0xf7){pos++;pos+=vlq();continue;}
   if(b&0x80){status=b;pos++;}
   const kind=status&0xf0,channel=status&0x0f;
   if(kind===0x90||kind===0x80){const pitch=bytes[pos++],velocity=bytes[pos++];const key=channel*128+pitch;if(kind===0x90&&velocity>0){open.set(key,{tick,velocity});}else{const start=open.get(key);if(start){raw.push({tick:start.tick,endTick:tick,pitch,velocity:start.velocity,channel});open.delete(key);}}}
   else if(kind===0xa0||kind===0xb0||kind===0xe0)pos+=2;
   else if(kind===0xc0||kind===0xd0)pos+=1;
   else throw Error('Unsupported MIDI event');
  }
  pos=end;
 }
 tempos.sort((a,b)=>a.tick-b.tick);if(!tempos.length||tempos[0].tick>0)tempos.unshift({tick:0,usPerQuarter:500000});
 const segments=[];let ms=0;tempos.forEach((t,i)=>{if(i){ms+=(t.tick-tempos[i-1].tick)*tempos[i-1].usPerQuarter/division/1000;}segments.push({tick:t.tick,ms,usPerQuarter:t.usPerQuarter});});
 const toMs=tick=>{let seg=segments[0];for(const s of segments){if(s.tick<=tick)seg=s;else break;}return seg.ms+(tick-seg.tick)*seg.usPerQuarter/division/1000;};
 const notes=raw.filter(n=>n.channel!==9).map(n=>({time:toMs(n.tick),dur:Math.max(30,toMs(n.endTick)-toMs(n.tick)),pitch:n.pitch,velocity:n.velocity/127,channel:n.channel})).sort((a,b)=>a.time-b.time);
 const bpm=Math.round(60000000/segments[0].usPerQuarter);
 return{notes,bpm,msPerQuarter:segments[0].usPerQuarter/1000,totalMs:notes.reduce((m,n)=>Math.max(m,n.time+n.dur),0)};
}
export function measureOnsetsFromTimemap(timemap){return timemap.filter(e=>e.measureOn).map(e=>e.tstamp);}
// Browser player. Loads sampled instruments lazily and schedules events ahead of the audio clock.
export function createPlayer({onTick,onEnd,onStatus=()=>{}}){
 let ctx,piano,bass,timer,raf,active=[],plan=null,rate=1,startAt=0,offsetMs=0,playing=false,paused=false,cursor=0,countInMs=0;
 const fonts={};
 async function loadFont(name){
  if(fonts[name])return fonts[name];
  onStatus('Loading sounds…');
  const data=await fetch(`/vendor/soundfont/${name}.json`).then(r=>{if(!r.ok)throw Error('Sounds could not be loaded.');return r.json();});
  const buffers=new Map();
  await Promise.all(Object.entries(data).map(async([note,b64])=>{const midi=noteNameToMidi(note);if(midi===null)return;const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));try{buffers.set(midi,await ctx.decodeAudioData(bytes.buffer));}catch(e){console.warn('sample',note,e);}}));
  fonts[name]=buffers;return buffers;
 }
 function sample(buffers,midi){if(buffers.has(midi))return{buffer:buffers.get(midi),detune:0};let best=null;for(const k of buffers.keys()){if(best===null||Math.abs(k-midi)<Math.abs(best-midi))best=k;}return best===null?null:{buffer:buffers.get(best),detune:(midi-best)*100};}
 function strike(buffers,midi,at,durSec,gain){
  const s=sample(buffers,midi);if(!s)return;const src=ctx.createBufferSource();src.buffer=s.buffer;src.detune.value=s.detune;const g=ctx.createGain();
  const release=0.18,stop=at+Math.min(durSec,s.buffer.duration-0.05);
  g.gain.setValueAtTime(0,at);g.gain.linearRampToValueAtTime(gain,at+0.006);g.gain.setValueAtTime(gain,Math.max(at+0.006,stop-release));g.gain.linearRampToValueAtTime(0.0001,stop+0.02);
  src.connect(g).connect(ctx.destination);src.start(at);src.stop(stop+0.05);active.push(src);src.onended=()=>{active=active.filter(x=>x!==src);};
 }
 function click(at,accent){const o=ctx.createOscillator(),g=ctx.createGain();o.type='square';o.frequency.value=accent?1400:1000;g.gain.setValueAtTime(accent?0.25:0.15,at);g.gain.exponentialRampToValueAtTime(0.001,at+0.05);o.connect(g).connect(ctx.destination);o.start(at);o.stop(at+0.06);active.push(o);}
 // plan: {notes,accompaniment,totalMs,msPerQuarter,beatsPerBar,melody,chords,bassOn,countIn}
 async function load(newPlan){ctx??=new(window.AudioContext||window.webkitAudioContext)();plan=newPlan;const wanted=[];if(plan.melody||plan.chords)wanted.push(loadFont('piano').then(b=>piano=b));if(plan.bassOn)wanted.push(loadFont('bass').then(b=>bass=b));await Promise.all(wanted);onStatus('');}
 function schedule(){
  if(!plan||!playing)return;const now=ctx.currentTime,horizon=now+0.15;
  const toCtx=ms=>startAt+(countInMs+ms)/rate/1000;
  while(cursor<plan.events.length){const e=plan.events[cursor];const at=toCtx(e.time);if(at>horizon)break;cursor++;if(at<now-0.05)continue;
   const dur=e.dur/rate/1000;
   if(e.kind==='note'&&plan.melody)strike(piano,e.pitch,at,dur,0.9*Math.max(0.35,e.velocity));
   else if(e.kind==='chord'){if(plan.chords)for(const p of e.pitches)strike(piano,p,at,dur*0.95,e.accent?0.28:0.2);if(plan.bassOn)strike(bass,e.bass,at,dur*0.9,e.accent?0.8:0.6);}
   else if(e.kind==='click')click(at,e.accent);
  }
  const endAt=toCtx(plan.totalMs)+0.4;if(cursor>=plan.events.length&&now>endAt)stop(true);
 }
 function tick(){if(!playing)return;const elapsed=(ctx.currentTime-startAt)*1000*rate-countInMs;onTick(Math.max(0,elapsed),elapsed<0?Math.ceil(-elapsed/plan.msPerBeat):0);raf=requestAnimationFrame(tick);}
 function buildEvents(fromMs){
  const events=[];
  if(plan.countIn&&fromMs===0){for(let b=0;b<plan.beatsPerBar;b++)events.push({kind:'click',time:-plan.countInMs+b*plan.msPerBeat,accent:b===0});}
  for(const n of plan.notes)if(n.time+n.dur>fromMs)events.push({kind:'note',...n,time:Math.max(n.time,fromMs),dur:n.time<fromMs?n.dur-(fromMs-n.time):n.dur});
  for(const c of plan.accompaniment)if(c.time+c.dur>fromMs)events.push({kind:'chord',...c,time:Math.max(c.time,fromMs),dur:c.time<fromMs?c.dur-(fromMs-c.time):c.dur});
  return events.sort((a,b)=>a.time-b.time);
 }
 async function start(fromMs=0){
  if(!plan)return;if(ctx.state==='suspended')await ctx.resume();
  plan.countInMs=plan.countIn&&fromMs===0?plan.beatsPerBar*plan.msPerBeat:0;countInMs=plan.countInMs;
  // event times are relative to the music start; count-in clicks sit at negative times
  plan.events=buildEvents(fromMs);
  cursor=0;offsetMs=fromMs;startAt=ctx.currentTime+0.05-fromMs/rate/1000;playing=true;paused=false;
  timer=setInterval(schedule,25);schedule();raf=requestAnimationFrame(tick);
 }
 function position(){if(!playing)return offsetMs;return Math.max(0,(ctx.currentTime-startAt)*1000*rate-countInMs);}
 function silence(){clearInterval(timer);cancelAnimationFrame(raf);for(const s of active){try{s.stop();}catch{}}active=[];}
 function pause(){if(!playing)return;offsetMs=position();silence();playing=false;paused=true;}
 function stop(finished=false){const was=playing||paused;silence();playing=false;paused=false;offsetMs=0;if(was)onEnd(finished);}
 function setRate(r){const wasPlaying=playing;const pos=position();if(wasPlaying)silence();rate=r;if(wasPlaying){playing=false;start(pos);}}
 return{load,start,pause,stop,setRate,position,isPlaying:()=>playing,isPaused:()=>paused,update(fields){if(plan)Object.assign(plan,fields);}};
}

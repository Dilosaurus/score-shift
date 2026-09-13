export const KEY_NAMES = {'-7':['C♭','A♭'],'-6':['G♭','E♭'],'-5':['D♭','B♭'],'-4':['A♭','F'],'-3':['E♭','C'],'-2':['B♭','G'],'-1':['F','D'],'0':['C','A'],'1':['G','E'],'2':['D','B'],'3':['A','F♯'],'4':['E','C♯'],'5':['B','G♯'],'6':['F♯','D♯'],'7':['C♯','A♯']};
const pcs={C:0,D:2,E:4,F:5,G:7,A:9,B:11}, steps='CDEFGAB';
export const mod=(n,m)=>((n%m)+m)%m;
const first=(el,name)=>el.getElementsByTagName(name)[0];
const value=(el,name,fallback='')=>first(el,name)?.textContent??fallback;
const accidentalName=alter=>({'-3':'triple-flat','-2':'flat-flat','-1':'flat','0':'natural','1':'sharp','2':'double-sharp','3':'triple-sharp'})[alter];
export function parseScore(xml,Parser=globalThis.DOMParser){
 if(typeof xml!=='string'||xml.length>15000000)throw Error('The score is too large (15 MB maximum).');
 if(/<!ENTITY/i.test(xml))throw Error('XML entity declarations are not supported.');
 const doc=new Parser().parseFromString(xml,'application/xml');
 if(doc.getElementsByTagName('parsererror').length||doc.documentElement.nodeName!=='score-partwise')throw Error('Import a valid partwise MusicXML score (.musicxml, .xml, or .mxl).');
 if(!doc.getElementsByTagName('measure').length)throw Error('This file contains no measures.');
 return doc;
}
export function scoreInfo(doc){
 const key=first(doc,'key'), fifths=Number(value(key||doc,'fifths',0)),minor=value(key||doc,'mode','major')==='minor';
 const layout=[...doc.getElementsByTagName('miscellaneous-field')].find(el=>el.getAttribute('name')==='scoreshift-layout')?.textContent;
 return {fifths,minor,keyName:`${KEY_NAMES[fifths]?.[minor?1:0]||'Custom'} ${minor?'minor':'major'}`,title:value(doc,'work-title',value(doc,'movement-title','Imported score')),notes:doc.getElementsByTagName('pitch').length,chords:doc.getElementsByTagName('harmony').length,measures:doc.getElementsByTagName('measure').length,...(layout==='encoded'?{layout}:{})};
}
export function chooseFifths(original,semitones){
 const target=mod(original*7+semitones,12);const choices=Object.keys(KEY_NAMES).map(Number).filter(n=>mod(n*7,12)===target);
 return choices.sort((a,b)=>Math.abs(a)-Math.abs(b)||Math.abs(a-original)-Math.abs(b-original))[0];
}
// Exact quarter-note positions keep tuplets, divisions changes and backed-up
// voices on the same key boundary, without floating-point ordering guesses.
const fraction=(n,d=1n)=>{
 if(d===0n)throw Error('Invalid rhythmic divisions.');
 if(d<0n){n=-n;d=-d;}
 let a=n<0n?-n:n,b=d;while(b){const r=a%b;a=b;b=r;}
 return[n/a,d/a];
};
const rational=text=>{
 const m=String(text).trim().match(/^([+-]?)(\d*)(?:\.(\d*))?$/);
 if(!m||!((m[2]||'')+(m[3]||'')).length)throw Error('Invalid rhythmic duration or divisions.');
 return fraction(BigInt((m[1]==='-'?'-':'')+(m[2]||'0')+(m[3]||'')),10n**BigInt((m[3]||'').length));
};
const add=(a,b)=>fraction(a[0]*b[1]+b[0]*a[1],a[1]*b[1]);
const subtract=(a,b)=>fraction(a[0]*b[1]-b[0]*a[1],a[1]*b[1]);
const divide=(a,b)=>fraction(a[0]*b[1],a[1]*b[0]);
const compare=(a,b)=>{const d=a[0]*b[1]-b[0]*a[1];return d<0n?-1:d>0n?1:0;};
const zero=[0n,1n],max=(a,b)=>compare(a,b)>=0?a:b;

// MusicXML importers may treat <alter> as sounding pitch only. Supply written
// accidentals as well, accounting for musical time in each staff/bar. Preserve
// authored marks and add parenthesized reminders on returns to the key signature
// after the same pitch was altered in the preceding bar (or a tied continuation).
export function refreshAccidentals(doc){
 const children=el=>[...el.childNodes].filter(n=>n.nodeType===1);
 const keyMap=fifths=>{const result={},order=fifths<0?'BEADGCF':'FCGDAEB';for(let i=0;i<Math.abs(fifths);i++)result[order[i%7]]=(result[order[i%7]]||0)+(fifths<0?-1:1);return result;};
 const later=new Set(['time-modification','stem','notehead','notehead-text','staff','beam','notations','lyric','play','listen']);
 for(const part of [...doc.getElementsByTagName('part')]){
  let divisions=[1n,1n],keys=new Map([['*',{}]]),priorBar=new Map();
  for(const measure of children(part).filter(n=>n.nodeName==='measure')){
   let cursor=zero,lastStart=zero;const events=[],written=new Map(),barPitches=new Map();
   for(const child of children(measure)){
    if(child.nodeName==='attributes'){
     const d=first(child,'divisions');if(d){divisions=rational(d.textContent);if(divisions[0]<=0n)throw Error('Invalid rhythmic divisions.');}
     for(const key of children(child).filter(n=>n.nodeName==='key')){
      const fifths=first(key,'fifths');if(fifths)events.push({time:cursor,key:key.getAttribute('number')||'*',map:keyMap(Number(fifths.textContent))});
     }
    }else if(child.nodeName==='backup')cursor=subtract(cursor,divide(rational(value(child,'duration',0)),divisions));
    else if(child.nodeName==='forward')cursor=add(cursor,divide(rational(value(child,'duration',0)),divisions));
    else if(child.nodeName==='note'){
     const chord=!!first(child,'chord'),time=chord?lastStart:cursor;
     if(first(child,'pitch'))events.push({time,note:child});
     if(!chord){lastStart=time;if(!first(child,'grace'))cursor=add(cursor,divide(rational(value(child,'duration',0)),divisions));}
    }
   }
   events.sort((a,b)=>compare(a.time,b.time)||Number(!a.key)-Number(!b.key));
   for(const event of events){
    if(event.key){
     const old=keys.get(event.key)||keys.get('*');
     const previousKeys=event.key==='*'?[...keys.values()]:[old];
     if(previousKeys.some(map=>steps.split('').some(s=>(map?.[s]||0)!==(event.map[s]||0)))){
      if(event.key==='*'){written.clear();barPitches.clear();priorBar.clear();}
      else{written.delete(event.key);barPitches.delete(event.key);priorBar.delete(event.key);}
     }
     if(event.key==='*')keys=new Map([['*',event.map]]);else keys.set(event.key,event.map);
     continue;
    }
    const note=event.note,pitch=first(note,'pitch'),staff=value(note,'staff','1'),step=value(pitch,'step'),octave=value(pitch,'octave'),alter=Number(value(pitch,'alter',0));
    const explicit=first(note,'accidental');
    if(!written.has(staff))written.set(staff,new Map());const state=written.get(staff),id=step+octave;
    if(!barPitches.has(staff))barPitches.set(staff,new Map());const heard=barPitches.get(staff);
    const keyAlter=(keys.get(staff)||keys.get('*'))?.[step]??0,previous=state.get(id)??keyAlter;
    const tied=children(note).some(n=>n.nodeName==='tie'&&n.getAttribute('type')==='stop');
    const lastPitch=heard.get(id)??priorBar.get(staff)?.get(id);
    const courtesy=!state.has(id)&&alter===keyAlter&&lastPitch!==undefined&&lastPitch!==alter;
    if(!explicit&&!tied&&(alter!==previous||courtesy)){
     const name=accidentalName(alter);
     if(name){
      const acc=doc.createElement('accidental');acc.textContent=name;
      if(courtesy&&alter===previous){acc.setAttribute('cautionary','yes');acc.setAttribute('parentheses','yes');}
      note.insertBefore(acc,children(note).find(n=>later.has(n.nodeName))||null);
     }
    }
    // A tie carries pitch over a barline, not accidental state for new attacks.
    if(!tied)state.set(id,alter);
    heard.set(id,alter);
   }
   priorBar=barPitches;
  }
 }
 return doc;
}
export function transposeScore(xml,semitones,targetFifths,Parser=globalThis.DOMParser,Serializer=globalThis.XMLSerializer){
 if(!Number.isInteger(semitones)||Math.abs(semitones)>24)throw Error('Choose an interval between -24 and +24 semitones.');
 const doc=parseScore(xml,Parser),info=scoreInfo(doc);
 const target=targetFifths??chooseFifths(info.fifths,semitones),fd=target-info.fifths;
 const k=(semitones-7*fd)/12;
 if(!Number.isInteger(k))throw Error('Target key does not match this interval.');
 if(semitones===0&&fd===0)return new Serializer().serializeToString(refreshAccidentals(doc));
 const children=el=>[...el.childNodes].filter(n=>n.nodeType===1);
 // Keep the requested initial spelling and ordinary relative keys. A modulation
 // that would exceed seven fifths needs its own equivalent key AND note spelling.
 const region=fifths=>{
  const candidate=fifths+fd;
  const to=fifths===info.fifths?target:Math.abs(candidate)<=7?candidate:chooseFifths(fifths,semitones);
  const localDelta=to-fifths;
  return{fifths:to,diatonic:4*localDelta+7*((semitones-7*localDelta)/12)};
 };
 const set=(el,name,text,after)=>{let child=first(el,name);if(!child){child=doc.createElement(name);if(after)el.insertBefore(child,after.nextSibling);else el.appendChild(child);}child.textContent=String(text);return child;};
 const shift=(el,stepName,alterName,octName,diatonic,held)=>{
  const step=first(el,stepName);if(!step||!(step.textContent in pcs))return;
  const oct=octName?Number(value(el,octName,4)):4;
  const midi=12*(oct+1)+pcs[step.textContent]+Number(value(el,alterName,0))+semitones;
  const abs=oct*7+steps.indexOf(step.textContent)+diatonic;
  const newOct=held?.octave??Math.floor(abs/7),newStep=held?.step??steps[mod(abs,7)];
  const alter=held?.alter??midi-(12*(newOct+1)+pcs[newStep]);
  step.textContent=newStep;step.removeAttribute('text');
  const old=first(el,alterName);if(alter!==0)set(el,alterName,alter,step);else if(old)el.removeChild(old);
  if(octName)set(el,octName,newOct);
  return{step:newStep,alter,octave:newOct};
 };
 for(const part of [...doc.getElementsByTagName('part')]){
  // Collect before mutating: XML voice order need not be musical order, and a
  // harmony offset can place it on either side of a later-written key change.
  let divisions=[1n,1n],barStart=zero;const events=[];
  for(const measure of children(part).filter(n=>n.nodeName==='measure')){
   let cursor=zero,lastStart=zero,end=zero;
   const duration=child=>divide(rational(value(child,'duration',0)),divisions);
   for(const child of children(measure)){
    if(child.nodeName==='attributes'){
     const d=first(child,'divisions');if(d){divisions=rational(d.textContent);if(divisions[0]<=0n)throw Error('Invalid rhythmic divisions.');}
     for(const key of children(child).filter(n=>n.nodeName==='key')){
      const fifth=first(key,'fifths');if(fifth)events.push({time:add(barStart,cursor),key,staff:key.getAttribute('number')||'*',region:region(Number(fifth.textContent))});
     }
    }else if(child.nodeName==='backup')cursor=subtract(cursor,duration(child));
    else if(child.nodeName==='forward'){cursor=add(cursor,duration(child));end=max(end,cursor);}
    else if(child.nodeName==='harmony')events.push({time:add(add(barStart,cursor),divide(rational(value(child,'offset',0)),divisions)),harmony:child,staff:value(child,'staff','1')});
    else if(child.nodeName==='note'){
     const chord=!!first(child,'chord'),time=chord?lastStart:cursor;
     if(first(child,'pitch'))events.push({time:add(barStart,time),note:child,staff:value(child,'staff','1')});
     const until=first(child,'grace')?time:add(time,duration(child));end=max(end,until);
     if(!chord){lastStart=time;cursor=until;}
    }
   }
   barStart=add(barStart,end);
  }
  events.sort((a,b)=>compare(a.time,b.time)||Number(!a.key)-Number(!b.key));
  let keys=new Map([['*',region(0)]]);const ties=new Map();
  for(const event of events){
   if(event.key){
    if(event.staff==='*')keys=new Map([['*',event.region]]);else keys.set(event.staff,event.region);
    first(event.key,'fifths').textContent=String(event.region.fifths);
    const cancel=first(event.key,'cancel');if(cancel)event.key.removeChild(cancel);
    continue;
   }
   const local=keys.get(event.staff)||keys.get('*');
   if(event.harmony){
    for(const root of [...event.harmony.getElementsByTagName('root')])shift(root,'root-step','root-alter',null,local.diatonic);
    for(const bass of [...event.harmony.getElementsByTagName('bass')])shift(bass,'bass-step','bass-alter',null,local.diatonic);
    continue;
   }
   const note=event.note,pitch=first(note,'pitch');
   const sourceMidi=12*(Number(value(pitch,'octave'))+1)+pcs[value(pitch,'step')]+Number(value(pitch,'alter',0));
   const tieId=event.staff+':'+value(note,'voice','1')+':'+sourceMidi;
   const types=children(note).filter(n=>n.nodeName==='tie').map(n=>n.getAttribute('type'));
   // A held note keeps its attack's spelling across a key boundary; subsequent
   // new attacks use the new region, even when they have the same sounding pitch.
   const spelling=shift(pitch,'step','alter','octave',local.diatonic,types.includes('stop')?ties.get(tieId):undefined);
   if(types.includes('stop'))ties.delete(tieId);
   if(types.includes('start'))ties.set(tieId,spelling);
   for(const acc of [...note.getElementsByTagName('accidental')]){
    const name=accidentalName(Number(value(pitch,'alter',0)));
    if(name){acc.textContent=name;acc.removeAttribute('smufl');}else note.removeChild(acc);
   }
  }
 }
 refreshAccidentals(doc);
 return new Serializer().serializeToString(doc);
}

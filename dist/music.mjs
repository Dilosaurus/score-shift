export const KEY_NAMES = {'-7':['C♭','A♭'],'-6':['G♭','E♭'],'-5':['D♭','B♭'],'-4':['A♭','F'],'-3':['E♭','C'],'-2':['B♭','G'],'-1':['F','D'],'0':['C','A'],'1':['G','E'],'2':['D','B'],'3':['A','F♯'],'4':['E','C♯'],'5':['B','G♯'],'6':['F♯','D♯'],'7':['C♯','A♯']};
const pcs={C:0,D:2,E:4,F:5,G:7,A:9,B:11}, steps='CDEFGAB';
export const mod=(n,m)=>((n%m)+m)%m;
const first=(el,name)=>el.getElementsByTagName(name)[0];
const value=(el,name,fallback='')=>first(el,name)?.textContent??fallback;
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
 return {fifths,minor,keyName:`${KEY_NAMES[fifths]?.[minor?1:0]||'Custom'} ${minor?'minor':'major'}`,title:value(doc,'work-title',value(doc,'movement-title','Imported score')),notes:doc.getElementsByTagName('pitch').length,chords:doc.getElementsByTagName('harmony').length,measures:doc.getElementsByTagName('measure').length};
}
export function chooseFifths(original,semitones){
 const target=mod(original*7+semitones,12);const choices=Object.keys(KEY_NAMES).map(Number).filter(n=>mod(n*7,12)===target);
 return choices.sort((a,b)=>Math.abs(a)-Math.abs(b)||Math.abs(a-original)-Math.abs(b-original))[0];
}
export function transposeScore(xml,semitones,targetFifths,Parser=globalThis.DOMParser,Serializer=globalThis.XMLSerializer){
 if(!Number.isInteger(semitones)||Math.abs(semitones)>24)throw Error('Choose an interval between -24 and +24 semitones.');
 const doc=parseScore(xml,Parser),info=scoreInfo(doc);
 const target=targetFifths??chooseFifths(info.fifths,semitones),fd=target-info.fifths;
 const k=(semitones-7*fd)/12;
 if(!Number.isInteger(k))throw Error('Target key does not match this interval.');
 const diatonic=4*fd+7*k;
 const set=(el,name,text,after)=>{let child=first(el,name);if(!child){child=doc.createElement(name);if(after)el.insertBefore(child,after.nextSibling);else el.appendChild(child);}child.textContent=String(text);return child;};
 const shift=(el,stepName,alterName,octName)=>{
  const step=first(el,stepName);if(!step||!(step.textContent in pcs))return;
  const oct=octName?Number(value(el,octName,4)):4;
  const midi=12*(oct+1)+pcs[step.textContent]+Number(value(el,alterName,0))+semitones;
  const abs=oct*7+steps.indexOf(step.textContent)+diatonic,newOct=Math.floor(abs/7),newStep=steps[mod(abs,7)];
  const alter=midi-(12*(newOct+1)+pcs[newStep]);
  step.textContent=newStep;step.removeAttribute('text');
  const old=first(el,alterName);if(alter!==0)set(el,alterName,alter,step);else if(old)el.removeChild(old);
  if(octName)set(el,octName,newOct);
 };
 for(const pitch of [...doc.getElementsByTagName('pitch')]){
  shift(pitch,'step','alter','octave');
  // Engravers calculate accidentals from the new key and pitch. Old cautionaries would be wrong.
  const note=pitch.parentNode;for(const acc of [...note.getElementsByTagName('accidental')])note.removeChild(acc);
 }
 for(const root of [...doc.getElementsByTagName('root')])shift(root,'root-step','root-alter');
 for(const bass of [...doc.getElementsByTagName('bass')])shift(bass,'bass-step','bass-alter');
 for(const key of [...doc.getElementsByTagName('key')]){const fifth=first(key,'fifths');if(fifth)fifth.textContent=String(Number(fifth.textContent)+fd);const cancel=first(key,'cancel');if(cancel)key.removeChild(cancel);}
 return new Serializer().serializeToString(doc);
}

import * as pdfjs from './vendor/pdf.mjs';
import {unzipSync,strFromU8} from './vendor/fflate.mjs';
import DOMPurify from './vendor/purify.es.mjs';
import {parseScore,scoreInfo,transposeScore,chooseFifths,KEY_NAMES,mod} from './music.mjs';
import {chordKinds,addHarmony} from './chords.mjs';
pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.mjs';
const $=s=>document.querySelector(s),all=s=>[...document.querySelectorAll(s)];
const state={scores:[],active:null,view:'original',zoom:100,render:0};
const active=()=>state.scores.find(s=>s.id===state.active);
let enginePromise,dbPromise,toastTimer;
const apiBase=['127.0.0.1','localhost'].includes(location.hostname)?'':'http://127.0.0.1:5173';
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,6000);}
function notice(message,error=false){$('#notice').replaceChildren();const icon=document.createElement('span');icon.textContent=error?'!':'◈';const text=document.createElement('span');text.textContent=message;$('#notice').append(icon,text);$('#notice').classList.toggle('error',error);}
function safeAction(fn){return async(...args)=>{try{await fn(...args);}catch(e){console.error(e);toast(e.message||'Something went wrong. Please try again.');}};}
function database(){return dbPromise??=new Promise((resolve,reject)=>{const req=indexedDB.open('scoreshift-device',1);req.onupgradeneeded=()=>req.result.createObjectStore('scores',{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function persist(s){try{const db=await database();await new Promise((resolve,reject)=>{const tx=db.transaction('scores','readwrite');tx.objectStore('scores').put({...s,pdf:undefined,job:undefined});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}catch{toast('This browser could not save the score. Keep this tab open or export your work.');}}
async function savedScores(){try{const db=await database();return await new Promise((resolve,reject)=>{const req=db.transaction('scores').objectStore('scores').getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}catch{return [];}}
async function toolkit(){return enginePromise??=Promise.all([import('./vendor/verovio-module.mjs'),import('./vendor/verovio.mjs')]).then(async([wasm,api])=>new api.VerovioToolkit(await wasm.default()));}
function unpackScore(bytes,name='score.xml'){
 let xml;
 if(/\.mxl$/i.test(name)||bytes[0]===80&&bytes[1]===75){
  const archive=unzipSync(bytes,{filter:file=>file.originalSize<15000000&&/\.(xml|musicxml)$/i.test(file.name)});
  const container=archive['META-INF/container.xml'];let root;
  if(container){const doc=new DOMParser().parseFromString(strFromU8(container),'application/xml');root=doc.querySelector('rootfile')?.getAttribute('full-path');}
  root??=Object.keys(archive).find(k=>!k.startsWith('META-INF/')&&/\.(xml|musicxml)$/i.test(k));
  if(!root||!archive[root])throw Error('The compressed score does not contain a readable MusicXML file.');xml=strFromU8(archive[root]);
 }else xml=new TextDecoder().decode(bytes);
 parseScore(xml);return xml;
}
async function loadPdf(s){
 if(s.pdf)return s.pdf;
 const loading=pdfjs.getDocument({data:new Uint8Array(s.bytes).slice(),cMapUrl:'/vendor/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/standard_fonts/',wasmUrl:'/vendor/wasm/',isEvalSupported:false});
 loading.onPassword=(update,reason)=>{const password=prompt(reason===2?'Incorrect password. Enter the PDF password:':'This PDF is protected. Enter its password:');if(password===null){loading.destroy();return;}update(password);};
 s.pdf=await loading.promise;
 if(s.pdf.numPages>100){await loading.destroy();s.pdf=null;throw Error('Please import a PDF with 100 pages or fewer.');}
 s.pages=s.pdf.numPages;
 return s.pdf;
}
async function importFile(file,attach=false){
 if(!file)return;if(file.size>50*1024*1024)throw Error('Choose a file smaller than 50 MB.');
 const bytes=new Uint8Array(await file.arrayBuffer()),isPdf=bytes.subarray(0,5).every((v,i)=>v==='%PDF-'.charCodeAt(i));
 if(isPdf&&attach)throw Error('Choose MusicXML to attach to this PDF.');
 const s=attach?active():{id:crypto.randomUUID(),name:file.name.replace(/\.[^.]+$/,''),semitones:0,reviewed:true};
 if(!s)throw Error('Import a PDF first.');
 if(isPdf){s.bytes=bytes;s.kind='pdf';s.reviewed=false;await loadPdf(s);let text='';for(let i=1;i<=s.pages;i++)text+=(await(await s.pdf.getPage(i)).getTextContent()).items.map(t=>t.str||'').join(' ');s.scanned=text.trim().length<20;}
 else {const xml=unpackScore(bytes,file.name),info=scoreInfo(parseScore(xml));s.xml=xml;s.info=info;s.targetFifths=info.fifths;s.semitones=0;s.kind=s.kind||'xml';if(!attach&&info.title!=='Imported score')s.name=info.title;s.reviewed=!s.recognized;}
 if(!attach)state.scores.push(s);state.active=s.id;state.view=isPdf?'original':s.bytes?'compare':'score';await persist(s);renderLibrary();await render();toast(isPdf?`${s.pages} PDF pages imported without changing the original.`:'Editable notes and chord symbols imported.');
}
async function openVisualExcerpt(){
 const id='golden-lady-visual-excerpt';
 let s=state.scores.find(score=>score.id===id);
 if(!s){const response=await fetch('/samples/golden-lady-visual-excerpt.musicxml');if(!response.ok)throw Error('The AI excerpt could not be loaded.');const xml=await response.text(),info=scoreInfo(parseScore(xml));s={id,name:'Golden Lady · AI excerpt',kind:'xml',xml,info,semitones:0,targetFifths:info.fifths,reviewed:false,visualDraft:true};state.scores.push(s);await persist(s);}
 state.active=s.id;state.view='score';renderLibrary();await render();
}
function renderLibrary(){
 $('#library-list').replaceChildren();$('#score-count').textContent=state.scores.length;
 for(const s of state.scores){const button=document.createElement('button');button.className='score-item'+(s.id===state.active?' selected':'');button.setAttribute('aria-pressed',String(s.id===state.active));const icon=document.createElement('span');icon.className='file-icon';icon.textContent='♫';const text=document.createElement('span'),title=document.createElement('strong'),sub=document.createElement('small');title.textContent=s.name;sub.textContent=s.xml?(s.recognized&&!s.reviewed?'Needs review':'Editable score'):`PDF · ${s.pages} pages`;text.append(title,sub);button.append(icon,text);button.onclick=safeAction(async()=>{state.active=s.id;state.view=s.bytes?'original':'score';renderLibrary();await render();});$('#library-list').append(button);}
}
function renderControls(){
 const s=active();if(!s)return;
 $('#score-title').textContent=s.name;$('#score-subtitle').textContent=s.visualDraft?'AI visual transcription · A section, four-measure draft':s.recognized?'Recognized from PDF · review required':s.xml?'MusicXML · editable notation':s.name==='Golden Lady'?'Stevie Wonder / Rhythm chart':'Imported PDF';
 const editable=!!s.xml;$('#original-key').textContent=editable?s.info.keyName:'Awaiting recognition';
 $('#target-key').replaceChildren();if(editable){for(const [fifths,names] of Object.entries(KEY_NAMES).sort((a,b)=>Number(a[0])-Number(b[0]))){const option=document.createElement('option');option.value=fifths;option.textContent=names[s.info.minor?1:0]+' '+(s.info.minor?'minor':'major');$('#target-key').append(option);}$('#target-key').value=s.targetFifths??s.info.fifths;}else{const o=document.createElement('option');o.textContent='Choose a key';$('#target-key').append(o);}
 for(const selector of ['#target-key','#step-down','#step-up','#reset'])$(selector).disabled=!editable;
 $('#step-down').disabled=!editable||s.semitones<=-24;$('#step-up').disabled=!editable||s.semitones>=24;
 $('#semitones').textContent=s.semitones>0?'+'+s.semitones:s.semitones||0;$('#interval-caption').textContent=s.semitones?`${Math.abs(s.semitones)} semitone${Math.abs(s.semitones)===1?'':'s'} ${s.semitones>0?'up':'down'}`:'Original pitch';
 $('#view-original').disabled=!s.bytes;$('#view-score').disabled=!editable;$('#view-compare').disabled=!editable||!s.bytes;
 ['original','score','compare'].forEach(v=>{const b=$('#view-'+v);b.classList.toggle('active',state.view===v);b.setAttribute('aria-pressed',String(state.view===v));});
 $('#recognize').hidden=editable||!s.bytes;$('#recognize').disabled=!!s.job;$('#recognize').textContent=s.job?'Recognizing…':'◈ Recognize music';$('#recognize').classList.toggle('busy',!!s.job);
 $('#attach-xml').textContent=editable?'Replace editable MusicXML':'Import matching MusicXML';
 $('#import-title').textContent=s.job?'Reading the music…':editable?s.recognized?'Review required':'Score ready':s.scanned?'Scan imported':'PDF imported';
 $('#import-description').textContent=s.job?s.job.stage:editable?`${s.info.notes} notes · ${s.info.chords} chord symbols · ${s.info.measures} measures${s.recognized?'. Check notes, rhythms, and missing chords against the original.':'. Ready to transpose.'}`:'All pages are preserved. Music recognition turns the printed notes into an editable score.';
 $('#recognition-caption').textContent=s.recognized?`${s.warnings||0} engine warnings. Recognition is a draft, not a verified transcription.`:'Recognition runs on this computer. Handwritten charts need careful review.';
 $('#review-actions').hidden=!editable;$('#reviewed').checked=!!s.reviewed;
 $('#review-actions .review-check').hidden=!s.recognized;
 $('#document-status').textContent=state.view==='original'?`${s.pages} page${s.pages===1?'':'s'} · Original PDF · unchanged`:`${s.info?.measures||0} measures · ${state.view==='compare'?'Compare scores':s.semitones?'Transposed notation':'Original notation'}`;
 if(s.job)notice('Recognizing the scan locally. This can take a few minutes. You can keep viewing the original.');
 else if(s.recognized&&!s.reviewed)notice(s.info.chords===0?'No chord symbols were recovered. Add missing chords in Review notes & chords, and check the recognized melody before exporting.':'Recognition needs review. Check pitches, rhythms, key signatures, repeats, and missing chord symbols before exporting.',true);
 else if(s.visualDraft)notice('AI-transcribed four-measure excerpt, not the full chart. Check against the original before using it in performance.');
 else if(editable)notice(state.view==='original'&&s.semitones?'The original PDF is unchanged. Open Editable score to see the transposition.':`Notes and chord symbols transpose together. ${s.semitones?'The editable score is in your selected key.':'Choose a key or change the semitone interval.'}`);
 else notice('Your original, preserved. Recognize the scan or import matching MusicXML to start transposing.');
}
async function render(){
 const s=active();if(!s)return;const epoch=++state.render;renderControls();$('#canvas-area').classList.toggle('compare',state.view==='compare');$('#original-pane').hidden=state.view==='score';$('#editable-pane').hidden=state.view==='original';
 if(state.view!=='score'){
  const doc=await loadPdf(s);if(epoch!==state.render)return;const target=$('#pdf-pages');target.replaceChildren();
  for(let p=1;p<=doc.numPages;p++){const page=await doc.getPage(p);if(epoch!==state.render)return;const viewport=page.getViewport({scale:1}),scale=Math.min(2,1500/viewport.width);const v=page.getViewport({scale});const paper=document.createElement('div');paper.className='paper';paper.style.width=state.zoom+'%';const canvas=document.createElement('canvas');canvas.width=v.width;canvas.height=v.height;canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`${s.name}, original PDF page ${p} of ${doc.numPages}`);paper.append(canvas);target.append(paper);await page.render({canvasContext:canvas.getContext('2d'),viewport:v}).promise;if(epoch!==state.render)return;}
 }
 if(state.view!=='original')await renderNotation(s,epoch);
 $('#zoom-label').textContent=state.zoom+'%';
}
function currentXML(s=active()){return transposeScore(s.xml,s.semitones||0,s.targetFifths??s.info.fifths);}
async function renderNotation(s,epoch=state.render){
 const vrv=await toolkit();if(epoch!==state.render)return;
 vrv.resetOptions();vrv.setOptions({inputFrom:'xml',pageWidth:2100,pageHeight:2970,scale:42,adjustPageHeight:true,breaks:'auto',header:'auto',footer:'none'});
 if(!vrv.loadData(currentXML(s)))throw Error('The recognized notation could not be engraved. Review or replace the MusicXML file.');
 const pages=vrv.getPageCount();if(!pages)throw Error('No notation pages were produced.');
 $('#notation-pages').replaceChildren();for(let i=1;i<=pages;i++){const paper=document.createElement('div');paper.className='paper';paper.style.width=state.zoom+'%';paper.innerHTML=DOMPurify.sanitize(vrv.renderToSVG(i),{USE_PROFILES:{svg:true,svgFilters:true},ADD_TAGS:['use'],ADD_ATTR:['viewBox','xlink:href']});paper.setAttribute('aria-label',`${s.name}, editable page ${i}`);$('#notation-pages').append(paper);}
}
async function setTranspose(n,target){
 const s=active();if(!s?.xml)throw Error('Recognize the PDF or import MusicXML first.');if(!Number.isInteger(n)||n<-24||n>24)throw Error('Choose -24 to +24 semitones.');s.semitones=n;s.targetFifths=target??chooseFifths(s.info.fifths,n);if(state.view==='original')state.view='score';await render();await persist(s);
}
async function recognizeMusic(){
 const s=active();if(!s?.bytes)return;
 if(s.pages>20)throw Error('For music recognition, split this into PDFs of 20 pages or fewer. The full PDF remains viewable.');
 let health;try{health=await fetch(apiBase+'/api/health',{signal:AbortSignal.timeout(5000)}).then(r=>r.json());}catch{throw Error('Start ScoreShift on your Windows computer to use music recognition, or import MusicXML. Recognition is local to that computer.');}
 if(!health.available)throw Error('Install the local recognition engine with setup-recognition.ps1, or import MusicXML.');
 const response=await fetch(apiBase+'/api/recognize',{method:'POST',headers:{'Content-Type':'application/pdf','X-ScoreShift':'recognize'},body:new Uint8Array(s.bytes)}),job=await response.json();if(!response.ok)throw Error(job.error||'Recognition could not start.');s.job={...job,stage:'Starting recognition'};renderControls();
 try{
  while(true){await new Promise(resolve=>setTimeout(resolve,2500));const response=await fetch(apiBase+'/api/jobs/'+job.id);const progress=await response.json();if(!response.ok)throw Error(progress.error);s.job=progress;if(active()===s)renderControls();if(progress.status==='failed')throw Error(progress.error);if(progress.status==='done'){
   for(let i=0;i<progress.movements;i++){const result=await fetch(`${apiBase}/api/jobs/${job.id}/result?index=${i}`);if(!result.ok)throw Error('Could not load a recognized movement.');const xml=unpackScore(new Uint8Array(await result.arrayBuffer()),'score.mxl');const score=i===0?s:{...s,id:crypto.randomUUID(),name:s.name+` · movement ${i+1}`,job:undefined};score.xml=xml;score.info=scoreInfo(parseScore(xml));score.targetFifths=score.info.fifths;score.semitones=0;score.recognized=true;score.reviewed=false;score.warnings=progress.warnings;if(i>0)state.scores.push(score);await persist(score);}
   if(progress.movements>1)toast(`Recognition produced ${progress.movements} movements. Each is available in My scores.`);break;
  }}
 }finally{s.job=null;if(active()===s){if(s.xml)state.view='compare';renderLibrary();await render();}}
}
function download(bytes,name,type){const url=URL.createObjectURL(new Blob([bytes],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function exportName(s,extension){return s.name.replace(/[<>:"/\\|?*]/g,'-')+(s.xml?' - '+KEY_NAMES[s.targetFifths]?.[s.info.minor?1:0]+' '+(s.info.minor?'minor':'major'):'')+'.'+extension;}
function openExport(){const s=active();$('#download-original').disabled=!s?.bytes;const locked=!s?.xml||(s.recognized&&!s.reviewed);$('#download-xml').disabled=locked;$('#print-score').disabled=locked;$('#export-warning').textContent=locked&&s?.xml?'Compare the recognized score with the original, correct any mistakes, then check “I’ve checked the recognized score” to export.':!s?.xml?'Recognize the PDF or import MusicXML to export transposed notation.':'PDF export uses your browser’s Print dialog. Select Save as PDF.';$('#export-dialog').showModal();}
 let reviewDoc;
const pitchText=(el,step='step',alter='alter',oct='octave')=>{const n=Number(el.querySelector(alter)?.textContent||0);return(el.querySelector(step)?.textContent||'C')+(n>0?'#'.repeat(n):'b'.repeat(-n))+(oct?el.querySelector(oct)?.textContent||'4':'');};
function setupHarmonyReview(){
 const rows=all('#review-editor .review-row');let divisions=1;
 [...reviewDoc.querySelectorAll('part > measure')].forEach((measure,mi)=>{
  const div=measure.querySelector('divisions');if(div)divisions=Number(div.textContent);rows[mi].dataset.divisions=divisions;
  [...measure.querySelectorAll('harmony')].forEach((h,hi)=>{const label=document.createElement('label');label.textContent=`Chord ${hi+1} quality`;const select=document.createElement('select');select.dataset.quality=hi;select.dataset.measure=mi;const kind=h.querySelector('kind')?.textContent||'major';for(const k of new Set([...chordKinds,kind])){const option=document.createElement('option');option.value=k;option.textContent=k;select.append(option);}select.value=kind;label.append(select);rows[mi].querySelector('.review-fields').append(label);});
  const add=document.createElement('div');add.className='add-harmony';const title=document.createElement('label');title.textContent='Add missing chords';const input=document.createElement('input');input.placeholder='Abmaj7@1, Cm7/G@3';input.dataset.addHarmony=mi;input.setAttribute('aria-label',`Add chords in measure ${mi+1}, with beat numbers`);const help=document.createElement('small');help.textContent='Chord@quarter-note beat, separated by commas. Existing chords stay in place.';title.append(input);add.append(title,help);rows[mi].append(add);
 });
}
function openReview(){
 const s=active();reviewDoc=parseScore(s.xml);const container=$('#review-editor');container.replaceChildren();
 const keyLabel=document.createElement('label');keyLabel.textContent='Initial key signature';const keySelect=document.createElement('select');keySelect.id='review-key';for(const [f,n]of Object.entries(KEY_NAMES)){const option=document.createElement('option');option.value=f;option.textContent=n[s.info.minor?1:0]+' '+(s.info.minor?'minor':'major');keySelect.append(option);}keySelect.value=s.info.fifths;keyLabel.append(keySelect);container.append(keyLabel);
 [...reviewDoc.querySelectorAll('part > measure')].forEach((measure,mi)=>{const details=document.createElement('details');details.className='review-row';const summary=document.createElement('summary');summary.textContent=`${measure.parentElement.id||'Part'} · Measure ${measure.getAttribute('number')||mi+1}`;details.append(summary);const fields=document.createElement('div');fields.className='review-fields';[...measure.querySelectorAll('pitch')].forEach((pitch,i)=>{const label=document.createElement('label');label.textContent='Note '+(i+1);const input=document.createElement('input');input.value=pitchText(pitch);input.dataset.measure=mi;input.dataset.note=i;input.setAttribute('aria-label',`Measure ${mi+1}, note ${i+1}, pitch and octave`);label.append(input);fields.append(label);});[...measure.querySelectorAll('harmony')].forEach((h,i)=>{for(const [kind,selector,step,alter]of [['root','root','root-step','root-alter'],['bass','bass','bass-step','bass-alter']]){const el=h.querySelector(selector);if(!el)continue;const label=document.createElement('label');label.textContent=`Chord ${i+1} ${kind}`;const input=document.createElement('input');input.value=pitchText(el,step,alter,null);input.dataset.measure=mi;input.dataset.harmony=i;input.dataset.kind=kind;label.append(input);fields.append(label);}});details.append(fields);container.append(details);});
 setupHarmonyReview();
 const advanced=document.createElement('details');advanced.className='review-row';const summary=document.createElement('summary');summary.textContent='Full MusicXML editor — rhythm, missing notes, and chords';const area=document.createElement('textarea');area.id='xml-review';area.value=s.xml;area.rows=15;area.spellcheck=false;area.setAttribute('aria-label','Edit complete original MusicXML');area.style.cssText='width:100%;margin-top:15px;font:12px monospace';area.oninput=()=>area.dataset.edited='true';advanced.append(summary,area);container.append(advanced);$('#review-dialog').showModal();
}
async function saveReview(){
 const s=active(),area=$('#xml-review');let xml;reviewDoc=parseScore(s.xml);
 if(area.dataset.edited==='true'){parseScore(area.value);xml=area.value;}else{
  const measures=[...reviewDoc.querySelectorAll('part > measure')];
  for(const input of all('#review-editor input[data-measure]')){const match=input.value.trim().match(/^([A-Ga-g])([#b]{0,2})(-?\d+)?$/);if(!match)throw Error(`Invalid pitch “${input.value}”. Use a pitch such as Bb4 or F#5.`);const isNote=input.dataset.note!==undefined;if(isNote&&match[3]===undefined)throw Error('Notes need an octave, such as C4.');if(isNote&&(Number(match[3])<-1||Number(match[3])>9))throw Error('Use an octave between -1 and 9.');const measure=measures[Number(input.dataset.measure)],el=isNote?measure.querySelectorAll('pitch')[Number(input.dataset.note)]:measure.querySelectorAll('harmony')[Number(input.dataset.harmony)].querySelector(input.dataset.kind),prefix=isNote?'':input.dataset.kind+'-';const step=el.querySelector(prefix+'step');step.textContent=match[1].toUpperCase();let alter=el.querySelector(prefix+'alter');const count=[...match[2]].reduce((n,c)=>n+(c==='#'?1:-1),0);if(count){if(!alter){alter=reviewDoc.createElement(prefix+'alter');el.insertBefore(alter,step.nextSibling);}alter.textContent=count;}else alter?.remove();if(isNote){el.querySelector('octave').textContent=match[3];el.parentElement.querySelector('accidental')?.remove();}}
  for(const select of all('#review-editor select[data-quality]')){const kind=measures[Number(select.dataset.measure)].querySelectorAll('harmony')[Number(select.dataset.quality)].querySelector('kind');if(kind){kind.textContent=select.value;kind.removeAttribute('text');}}
  for(const input of all('#review-editor input[data-add-harmony]')){const mi=Number(input.dataset.addHarmony);for(const entry of input.value.split(',').map(s=>s.trim()).filter(Boolean)){const [symbol,beat='1']=entry.split('@');addHarmony(reviewDoc,measures[mi],symbol,Number(beat),Number(input.closest('.review-row').dataset.divisions));}}
  const fifth=reviewDoc.querySelector('key fifths');if(fifth)fifth.textContent=$('#review-key').value;xml=new XMLSerializer().serializeToString(reviewDoc);
 }
 s.xml=xml;s.info=scoreInfo(parseScore(xml));s.semitones=0;s.targetFifths=s.info.fifths;s.reviewed=!s.recognized;await persist(s);$('#review-dialog').close();renderLibrary();await render();toast('Corrections saved at the original pitch.');
}
all('#import-top,#import-side').forEach(b=>b.onclick=()=>$('#file-input').click());
$('#open-excerpt').onclick=safeAction(openVisualExcerpt);
$('#file-input').onchange=safeAction(async e=>{for(const f of e.target.files)await importFile(f);e.target.value='';});
$('#xml-input').onchange=safeAction(async e=>{await importFile(e.target.files[0],true);e.target.value='';});
$('#attach-xml').onclick=()=>$('#xml-input').click();
for(const v of ['original','score','compare'])$('#view-'+v).onclick=safeAction(async()=>{state.view=v;await render();});
$('#step-down').onclick=safeAction(()=>setTranspose(active().semitones-1));$('#step-up').onclick=safeAction(()=>setTranspose(active().semitones+1));$('#reset').onclick=safeAction(()=>setTranspose(0,active().info.fifths));
$('#target-key').onchange=safeAction(async e=>{const s=active(),f=Number(e.target.value);let n=mod((f-s.info.fifths)*7,12);if(n>6)n-=12;await setTranspose(n,f);});
for(const [selector,amount]of [['#zoom-in',10],['#zoom-out',-10]])$(selector).onclick=()=>{state.zoom=Math.min(180,Math.max(50,state.zoom+amount));all('.paper').forEach(p=>p.style.width=state.zoom+'%');$('#zoom-label').textContent=state.zoom+'%';};
$('#fit').onclick=()=>{state.zoom=100;all('.paper').forEach(p=>p.style.width='100%');$('#zoom-label').textContent='100%';};
$('#recognize').onclick=safeAction(recognizeMusic);$('#export-open').onclick=openExport;$('#review-open').onclick=openReview;$('#save-review').onclick=safeAction(saveReview);
$('#reviewed').onchange=safeAction(async e=>{active().reviewed=e.target.checked;await persist(active());renderLibrary();renderControls();});
$('#download-original').onclick=()=>download(active().bytes,active().name+'.pdf','application/pdf');
$('#download-xml').onclick=safeAction(()=>{const s=active();if(s.recognized&&!s.reviewed)throw Error('Review the recognized score first.');download(currentXML(),exportName(s,'musicxml'),'application/vnd.recordare.musicxml+xml');});
$('#print-score').onclick=safeAction(async()=>{const s=active();if(s.recognized&&!s.reviewed)throw Error('Review the recognized score first.');$('#export-dialog').close();state.view='score';await render();await document.fonts.ready;window.print();});
let dragDepth=0;document.addEventListener('dragenter',e=>{if(e.dataTransfer?.types.includes('Files')){e.preventDefault();dragDepth++;document.body.classList.add('drop-active');}});document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('dragleave',()=>{if(--dragDepth<=0)document.body.classList.remove('drop-active');});document.addEventListener('drop',safeAction(async e=>{e.preventDefault();dragDepth=0;document.body.classList.remove('drop-active');for(const file of e.dataTransfer.files)await importFile(file);}));
async function init(){
 state.scores=await savedScores();
 if(!state.scores.length){const response=await fetch('/samples/golden-lady.pdf');if(!response.ok)throw Error('The sample PDF could not be loaded. Import a PDF to begin.');const s={id:'golden-lady-sample',name:'Golden Lady',kind:'pdf',bytes:new Uint8Array(await response.arrayBuffer()),pages:2,scanned:true,reviewed:false,semitones:0};state.scores=[s];await persist(s);}
 state.active=state.scores[0].id;state.view=active().bytes?'original':'score';
 if(new URLSearchParams(location.search).get('score')==='ai-excerpt')await openVisualExcerpt();else{renderLibrary();await render();}
 $('#engine-status').textContent='Saved on this device';
 if(document.modelContext?.registerTool){try{document.modelContext.registerTool({name:'transpose_active_score',title:'Transpose active score',description:'Change notes and chord symbols of the active editable score by semitones. Does not export or modify the original PDF.',inputSchema:{type:'object',properties:{semitones:{type:'integer',minimum:-24,maximum:24}},required:['semitones'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:async input=>{if(!input||Object.keys(input).some(k=>k!=='semitones'))throw Error('Invalid input');await setTranspose(input.semitones);return {title:active().name,semitones:active().semitones,targetKey:$('#target-key').selectedOptions[0].textContent};}});}catch(e){console.warn('WebMCP unavailable',e);}}
}
safeAction(init)();

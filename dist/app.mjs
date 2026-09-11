import * as pdfjs from './vendor/pdf.mjs';
import {unzipSync,strFromU8} from './vendor/fflate.mjs';
import DOMPurify from './vendor/purify.es.mjs';
import {parseScore,scoreInfo,transposeScore,chooseFifths,KEY_NAMES,mod} from './music.mjs';
import {chordKinds,addHarmony} from './chords.mjs';
import {engravingOptions,formatMusicXML,formatNotationSVG} from './engraving.mjs';
import {createSongbook,newCode,normalizeCode,reconcile,hasBlob} from './songbook.mjs';
pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.mjs';
const $=s=>document.querySelector(s),all=s=>[...document.querySelectorAll(s)];
const state={scores:[],active:null,view:'original',zoom:100,render:0,page:1,fit:'width',songbook:null,songbookReady:false};
const SONGBOOK_KEY='scoreshift-songbook';
const active=()=>state.scores.find(s=>s.id===state.active);
let enginePromise,dbPromise,toastTimer;
const apiBase=['127.0.0.1','localhost'].includes(location.hostname)?'':'http://127.0.0.1:5173';
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,6000);}
function notice(message,error=false){$('#notice').replaceChildren();const icon=document.createElement('span');icon.textContent=error?'!':'◈';const text=document.createElement('span');text.textContent=message;$('#notice').append(icon,text);$('#notice').classList.toggle('error',error);}
function safeAction(fn){return async(...args)=>{try{await fn(...args);}catch(e){console.error(e);toast(e.message||'Something went wrong. Please try again.');}};}
function database(){return dbPromise??=new Promise((resolve,reject)=>{const req=indexedDB.open('scoreshift-device',1);req.onupgradeneeded=()=>req.result.createObjectStore('scores',{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function persistLocal(s){try{const db=await database();await new Promise((resolve,reject)=>{const tx=db.transaction('scores','readwrite');tx.objectStore('scores').put({...s,pdf:undefined,job:undefined,dirty:undefined,confirmRemove:undefined});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}catch{toast('This browser could not save the score. Keep this tab open or export your work.');}}
async function deleteLocal(id){try{const db=await database();await new Promise((resolve,reject)=>{const tx=db.transaction('scores','readwrite');tx.objectStore('scores').delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}catch{}}
async function persist(s){await persistLocal(s);if(!state.songbook)return;s.dirty=true;state.songbook.save(s).catch(e=>{console.error(e);songbookStatus('Could not save to the songbook. '+(e.message||'Try again.'),'error');}).finally(()=>{s.dirty=false;persistLocal(s);});}
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
 if(!attach)state.scores.push(s);closeDialogs();state.page=1;state.active=s.id;state.view=isPdf?'original':s.bytes?'compare':'score';await persist(s);renderLibrary();await render();toast(isPdf?`${s.pages} PDF pages imported without changing the original.`:'Editable notes and chord symbols imported.');
}
async function openVisualExcerpt(){
 const id='golden-lady-visual-excerpt';
 let s=state.scores.find(score=>score.id===id);
 if(!s){const response=await fetch('/samples/golden-lady-visual-excerpt.musicxml');if(!response.ok)throw Error('The AI excerpt could not be loaded.');const xml=await response.text(),info=scoreInfo(parseScore(xml));s={id,name:'Golden Lady · AI excerpt',kind:'xml',xml,info,semitones:0,targetFifths:info.fifths,reviewed:false,visualDraft:true};state.scores.push(s);await persist(s);}
 state.active=s.id;state.view='score';renderLibrary();await render();
}
async function openFullTranscription(){
 const id='golden-lady-full-v1';
 let s=state.scores.find(score=>score.id===id);
 if(!s||(!s.userEdited&&(s.sampleRevision||1)<2)){
  const [response,pdf]=await Promise.all([fetch('/samples/golden-lady-full.musicxml'),fetch('/samples/golden-lady.pdf')]);
  if(!response.ok||!pdf.ok)throw Error('The full transcription could not be loaded.');
  const xml=await response.text(),info=scoreInfo(parseScore(xml));
  const entry={id,name:'Golden Lady · Full transcription',kind:'xml',xml,info,bytes:new Uint8Array(await pdf.arrayBuffer()),pages:2,semitones:0,targetFifths:info.fifths,visualFull:true,reviewed:true,sampleRevision:2};
  if(s)Object.assign(s,entry);else{s=entry;state.scores.push(s);}await persist(s);
 }
 state.active=s.id;state.view='score';renderLibrary();await render();
}
function renderLibrary(){
 $('#library-list').replaceChildren();$('#score-count').textContent=state.scores.length;
 for(const s of state.scores){const row=document.createElement('div');row.className='score-item'+(s.id===state.active?' selected':'');const button=document.createElement('button');button.className='score-open';button.setAttribute('aria-pressed',String(s.id===state.active));const icon=document.createElement('span');icon.className='file-icon';icon.textContent='♫';const text=document.createElement('span'),title=document.createElement('strong'),sub=document.createElement('small');title.textContent=s.visualFull?'Golden Lady':s.name;sub.textContent=s.visualFull?'Complete transcription · 51 measures':hasBlob(s,'xml')?(s.recognized&&!s.reviewed?'Needs review':`${s.info?.measures??'?'} measures · Editable score`):`PDF · ${s.pages||'?'} pages`;if(s.missing?.length)sub.textContent+=' · downloading';text.append(title,sub);button.append(icon,text);button.onclick=safeAction(async()=>{state.active=s.id;state.page=1;state.view=hasBlob(s,'xml')?'score':'original';closeDialogs();renderLibrary();await render();});if(s.confirmRemove){row.classList.add('confirming');const ask=document.createElement('div');ask.className='score-confirm';const q=document.createElement('span');q.textContent=state.songbook?`Remove “${s.visualFull?'Golden Lady':s.name}” for everyone?`:`Remove “${s.visualFull?'Golden Lady':s.name}” from this device?`;const yes=document.createElement('button');yes.className='button danger';yes.textContent='Remove';yes.onclick=safeAction(()=>removeScore(s));const no=document.createElement('button');no.className='button';no.textContent='Keep';no.onclick=()=>{delete s.confirmRemove;renderLibrary();};ask.append(q,yes,no);row.append(ask);$('#library-list').append(row);continue;}const remove=document.createElement('button');remove.className='score-remove';remove.textContent='×';remove.setAttribute('aria-label',`Remove ${s.name}`);remove.title='Remove score';remove.onclick=()=>{for(const other of state.scores)delete other.confirmRemove;s.confirmRemove=true;renderLibrary();row.querySelector('.button.danger')?.focus();};row.append(button,remove);$('#library-list').append(row);}
 $('#open-full').hidden=state.scores.some(s=>s.visualFull);$('#open-excerpt').hidden=state.scores.some(s=>s.visualDraft);$('.library-samples').hidden=$('#open-full').hidden&&$('#open-excerpt').hidden;
 filterLibrary();
}
function renderControls(){
 const s=active();if(!s)return;
 $('#score-title').textContent=s.visualFull?'Golden Lady':s.name;$('#score-subtitle').textContent=s.visualFull?'Stevie Wonder':s.visualDraft?'Four-measure excerpt':s.recognized?'Transcription · needs review':s.xml?'Editable score':'Original PDF';
 const editable=hasBlob(s,'xml'),hasPdf=hasBlob(s,'bytes');$('#original-key').textContent=editable?s.info.keyName:'Awaiting recognition';
 $('#current-key').textContent=editable?KEY_NAMES[s.targetFifths??s.info.fifths]?.[s.info.minor?1:0]:'Key';$('#transpose-open').disabled=!editable;$('#transpose-open').classList.toggle('changed',!!s.semitones);$('#source-label').textContent=state.view==='original'?'Original PDF':state.view==='compare'?'Compare':'Transcription';
 $('#target-key').replaceChildren();if(editable){for(const [fifths,names] of Object.entries(KEY_NAMES).sort((a,b)=>Number(a[0])-Number(b[0]))){const option=document.createElement('option');option.value=fifths;option.textContent=names[s.info.minor?1:0]+' '+(s.info.minor?'minor':'major');$('#target-key').append(option);}$('#target-key').value=s.targetFifths??s.info.fifths;}else{const o=document.createElement('option');o.textContent='Choose a key';$('#target-key').append(o);}
 for(const selector of ['#target-key','#step-down','#step-up','#reset'])$(selector).disabled=!editable;
 $('#step-down').disabled=!editable||s.semitones<=-24;$('#step-up').disabled=!editable||s.semitones>=24;
 $('#semitones').textContent=s.semitones>0?'+'+s.semitones:s.semitones||0;$('#interval-caption').textContent=s.semitones?`${Math.abs(s.semitones)} semitone${Math.abs(s.semitones)===1?'':'s'} ${s.semitones>0?'up':'down'}`:'Original pitch';
 $('#view-original').disabled=!hasPdf;$('#view-score').disabled=!editable;$('#view-compare').disabled=!editable||!hasPdf;
 ['original','score','compare'].forEach(v=>{const b=$('#view-'+v);b.classList.toggle('active',state.view===v);b.setAttribute('aria-pressed',String(state.view===v));});
 $('#recognize').hidden=editable||!hasPdf;$('#recognize').disabled=!!s.job;$('#recognize').textContent=s.job?'Recognizing…':'◈ Recognize music';$('#recognize').classList.toggle('busy',!!s.job);
 $('#attach-xml').textContent=editable?'Replace editable MusicXML':'Import matching MusicXML';
 $('#import-title').textContent=s.job?'Reading the music…':editable?s.recognized?'Review required':'Score ready':s.scanned?'Scan imported':'PDF imported';
 $('#import-description').textContent=s.job?s.job.stage:editable?`${s.info.notes} notes · ${s.info.chords} chord symbols · ${s.info.measures} measures${s.recognized?'. Check notes, rhythms, and missing chords against the original.':'. Ready to transpose.'}`:'All pages are preserved. Music recognition turns the printed notes into an editable score.';
 $('#recognition-caption').textContent=s.visualFull?'Transcribed visually from the complete scan. Includes lyrics, repeats, endings, and key changes.':s.recognized?`${s.warnings||0} engine warnings. Recognition is a draft, not a verified transcription.`:'Recognition runs on this computer. Handwritten charts need careful review.';
 $('#review-actions').hidden=!editable;$('#reviewed').checked=!!s.reviewed;
 $('#review-actions .review-check').hidden=!s.recognized;
 $('#document-status').textContent=state.view==='original'?`${s.pages} page${s.pages===1?'':'s'} · Original PDF · unchanged`:`${s.info?.measures||0} measures · ${state.view==='compare'?'Compare scores':s.semitones?'Transposed notation':'Original notation'}`;
 if(s.job)notice('Recognizing the scan locally. This can take a few minutes. You can keep viewing the original.');
 else if(s.recognized&&!s.reviewed)notice(s.info.chords===0?'No chord symbols were recovered. Add missing chords in Review notes & chords, and check the recognized melody before exporting.':'Recognition needs review. Check pitches, rhythms, key signatures, repeats, and missing chord symbols before exporting.',true);
 else if(s.visualFull)notice('Complete visual transcription. Notes and chords transpose together; Compare shows the supplied scan alongside it.');
 else if(s.visualDraft)notice('AI-transcribed four-measure excerpt, not the full chart. Check against the original before using it in performance.');
 else if(editable)notice(state.view==='original'&&s.semitones?'The original PDF is unchanged. Open Editable score to see the transposition.':`Notes and chord symbols transpose together. ${s.semitones?'The editable score is in your selected key.':'Choose a key or change the semitone interval.'}`);
 else notice('Your original, preserved. Recognize the scan or import matching MusicXML to start transposing.');
}
function renderEmpty(){state.render++;$('#score-title').textContent='No score open';$('#score-subtitle').textContent='Import a PDF or MusicXML file';$('#pdf-pages').replaceChildren();$('#notation-pages').replaceChildren();$('#transpose-open').disabled=true;$('#page-label').textContent='0 / 0';$('#page-prev').disabled=$('#page-next').disabled=true;$('#reader-loading').hidden=true;$('#canvas-area').classList.remove('loading');}
async function render(){
 const s=active();if(!s){renderEmpty();return;}const epoch=++state.render;
 if(s.missing?.length){$('#reader-loading').hidden=false;try{await state.songbook?.fetchBlobs(s);}catch(e){console.error(e);toast(e.message);}if(epoch!==state.render)return;await persistLocal(s);renderLibrary();}
 renderControls();$('#canvas-area').classList.toggle('compare',state.view==='compare');$('#original-pane').hidden=state.view==='score';$('#editable-pane').hidden=state.view==='original';$('#reader-loading').hidden=false;$('#canvas-area').classList.add('loading');
 try{
 if(state.view!=='score'){
  const doc=await loadPdf(s);if(epoch!==state.render)return;const target=$('#pdf-pages');target.replaceChildren();
  for(let p=1;p<=doc.numPages;p++){const page=await doc.getPage(p);if(epoch!==state.render)return;const viewport=page.getViewport({scale:1}),scale=Math.min(2,1500/viewport.width);const v=page.getViewport({scale});const paper=document.createElement('div');paper.className='paper';paper.style.width=state.zoom+'%';const canvas=document.createElement('canvas');canvas.width=v.width;canvas.height=v.height;canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`${s.name}, original PDF page ${p} of ${doc.numPages}`);paper.append(canvas);target.append(paper);await page.render({canvasContext:canvas.getContext('2d'),viewport:v}).promise;if(epoch!==state.render)return;}
 }
 if(state.view!=='original')await renderNotation(s,epoch);
 if(epoch===state.render)updatePages();
 }finally{if(epoch===state.render){$('#reader-loading').hidden=true;$('#canvas-area').classList.remove('loading');}}
}
function currentXML(s=active()){return formatMusicXML(transposeScore(s.xml,s.semitones||0,s.targetFifths??s.info.fifths));}
function engravingXML(xml){
 // Verovio currently prints hidden degrees in addition to the custom chord label.
 // Respect their display flag in this render-only copy; exports retain the harmony data.
 const doc=parseScore(xml);
 for(const degree of doc.querySelectorAll('harmony > degree[print-object="no"]'))degree.remove();
 return new XMLSerializer().serializeToString(doc);
}
async function renderNotation(s,epoch=state.render){
 const vrv=await toolkit();if(epoch!==state.render)return;
 vrv.resetOptions();vrv.setOptions({...engravingOptions,breaks:s.visualFull?'encoded':'auto'});
 if(!vrv.loadData(engravingXML(currentXML(s))))throw Error('The recognized notation could not be engraved. Review or replace the MusicXML file.');
 const pages=vrv.getPageCount();if(!pages)throw Error('No notation pages were produced.');
 $('#notation-pages').replaceChildren();for(let i=1;i<=pages;i++){const paper=document.createElement('div');paper.className='paper';paper.innerHTML=DOMPurify.sanitize(formatNotationSVG(vrv.renderToSVG(i),{fixedSystems:s.visualFull,page:i,pageCount:pages}),{USE_PROFILES:{svg:true,svgFilters:true},ADD_TAGS:['use'],ADD_ATTR:['viewBox','xlink:href']});paper.setAttribute('aria-label',`${s.name}, editable page ${i}`);$('#notation-pages').append(paper);}
}
function closeDialogs(){all('dialog[open]').forEach(d=>d.close());}
function openPanel(id){closeDialogs();$(id).showModal();}
function filterLibrary(){const q=$('#library-search').value.toLowerCase().trim();let count=0;all('#library-list .score-item').forEach(b=>{b.hidden=!(b.querySelector('.score-open')?.textContent||b.textContent).toLowerCase().includes(q);if(!b.hidden)count++;});$('#library-empty').hidden=!!count;}
function updatePages(){
 const targets=state.view==='compare'?['#pdf-pages','#notation-pages']:[state.view==='original'?'#pdf-pages':'#notation-pages'];
 const count=Math.max(1,...targets.map(t=>$(t).children.length));state.page=Math.min(count,Math.max(1,state.page));
 for(const t of ['#pdf-pages','#notation-pages'])[...$(t).children].forEach((p,i)=>p.dataset.current=String(i===state.page-1));
 $('#page-label').textContent=`${state.page} / ${count}`;$('#page-prev').disabled=state.page<=1;$('#page-next').disabled=state.page>=count;
 applyZoom();
}
function applyZoom(){
 for(const paper of all('.paper')){
  const container=paper.closest('.score-pane'),visual=paper.querySelector('svg,canvas'),aspect=visual?.tagName.toLowerCase()==='svg'?parseFloat(visual.getAttribute('width'))/parseFloat(visual.getAttribute('height')):visual?visual.width/visual.height:2160/2794;
  const width=Math.min(container.clientWidth,1120),height=$('#canvas-area').clientHeight-(state.view==='compare'?72:48);
  const base=state.fit==='page'?Math.min(width,height*aspect):width;
  paper.style.width=Math.round(base*state.zoom/100)+'px';paper.style.maxWidth='none';
 }
 $('#zoom-label').textContent=state.zoom+'%';$('#fit-width').classList.toggle('active',state.fit==='width');$('#fit-page').classList.toggle('active',state.fit==='page');
}
function turnPage(amount){const before=state.page;state.page+=amount;updatePages();if(before!==state.page)$('#canvas-area').scrollTo(0,0);}
function zoomBy(amount){state.zoom=Math.min(240,Math.max(50,state.zoom+amount));applyZoom();}
function setFit(mode){state.fit=mode;state.zoom=100;applyZoom();$('#canvas-area').scrollTo(0,0);}
function focusMode(on){closeDialogs();document.body.classList.toggle('focus-mode',on);$('#focus-exit').hidden=!on;requestAnimationFrame(applyZoom);}
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
 s.xml=xml;s.info=scoreInfo(parseScore(xml));s.semitones=0;s.targetFifths=s.info.fifths;s.reviewed=!s.recognized;s.userEdited=true;await persist(s);$('#review-dialog').close();renderLibrary();await render();toast('Corrections saved at the original pitch.');
}
async function removeScore(s){
 const name=s.visualFull?'Golden Lady':s.name;delete s.confirmRemove;
 state.scores.splice(state.scores.indexOf(s),1);await deleteLocal(s.id);
 if(state.songbook)state.songbook.remove(s.id).catch(e=>{console.error(e);toast('Could not remove it from the songbook. '+(e.message||''));});
 if(state.active===s.id){if(state.scores.length){state.active=state.scores[0].id;state.page=1;state.view=hasBlob(active(),'xml')?'score':'original';await render();}else{state.active=null;renderEmpty();}}
 renderLibrary();toast(`Removed “${name}”.`);
}
function songbookStatus(text,kind='ok'){$('#songbook-status').textContent=text;$('.songbook-state').className='songbook-state '+kind;}
function renderSongbook(){const on=!!state.songbook;$('#songbook-off').hidden=on;$('#songbook-on').hidden=!on;$('#songbook-code-display').textContent=on?state.songbook.code:'';$('#engine-status').textContent=on?'Synced with the shared songbook':'Saved on this device';}
async function prefetchMissing(){for(const s of [...state.scores]){if(!state.songbook)return;if(s.missing?.length&&s.id!==state.active){try{await state.songbook.fetchBlobs(s);await persistLocal(s);renderLibrary();}catch(e){console.error(e);}}}}
function onSongbookChange(changes,remoteIds){
 const {fetch,removed,added,updated}=reconcile(state.scores,changes);
 for(const id of removed)deleteLocal(id);
 for(const id of [...added,...updated]){const s=state.scores.find(x=>x.id===id);if(s)persistLocal(s);}
 if(!state.songbookReady){
  state.songbookReady=true;
  for(const s of [...state.scores]){if(remoteIds.includes(s.id))continue;if(s.sync){state.scores.splice(state.scores.indexOf(s),1);deleteLocal(s.id);if(s.id===state.active)state.active=null;}else persist(s);}
  prefetchMissing();
 }
 const activeGone=removed.includes(state.active)||!active();
 if(activeGone){if(state.scores.length){state.active=state.scores[0].id;state.page=1;state.view=hasBlob(active(),'xml')?'score':'original';safeAction(render)();}else{state.active=null;renderEmpty();}}
 else if(fetch.includes(state.active)||updated.includes(state.active))safeAction(render)();
 renderLibrary();
}
async function connectSongbook(code){
 state.songbook?.stop();state.songbookReady=false;
 const songbook=createSongbook({code,onChange:onSongbookChange,onStatus:songbookStatus});state.songbook=songbook;localStorage.setItem(SONGBOOK_KEY,code);renderSongbook();
 try{await songbook.connect();}catch(e){console.error(e);songbook.stop();if(state.songbook===songbook){state.songbook=null;localStorage.removeItem(SONGBOOK_KEY);renderSongbook();}throw Error('Could not open that songbook. '+(e.code==='permission-denied'?'Check the invite link.':'Check your connection and try again.'));}
}
async function startSongbook(){await connectSongbook(newCode());toast('Shared songbook started. Share the invite link so others can join.');}
async function joinSongbook(text){const code=normalizeCode(text);if(!code)throw Error('That invite link or code is not valid. Paste the whole link.');if(state.songbook?.code===code)return;await connectSongbook(code);toast('Joined the shared songbook.');}
async function leaveSongbook(){
 if(!state.songbook)return;
 const button=$('#songbook-leave');
 if(button.dataset.armed!=='true'){button.dataset.armed='true';button.textContent='Tap again to leave. Scores stay in the songbook.';clearTimeout(button._disarm);button._disarm=setTimeout(()=>{button.dataset.armed='';button.textContent='Leave songbook on this device';},6000);return;}
 clearTimeout(button._disarm);button.dataset.armed='';button.textContent='Leave songbook on this device';
 state.songbook.stop();state.songbook=null;localStorage.removeItem(SONGBOOK_KEY);
 for(const s of [...state.scores]){if(s.missing?.length){state.scores.splice(state.scores.indexOf(s),1);await deleteLocal(s.id);if(s.id===state.active)state.active=null;}else{delete s.sync;await persistLocal(s);}}
 if(!active()){if(state.scores.length){state.active=state.scores[0].id;state.view=hasBlob(active(),'xml')?'score':'original';await render();}else renderEmpty();}
 renderSongbook();renderLibrary();
}
async function shareSongbook(){
 const url=state.songbook.link();
 if(navigator.share){try{await navigator.share({title:'ScoreShift songbook',text:'Join our shared songbook in ScoreShift.',url});return;}catch(e){if(e.name==='AbortError')return;}}
 await navigator.clipboard.writeText(url);toast('Invite link copied. Send it to whoever should share this songbook.');
}
$('#songbook-create').onclick=safeAction(startSongbook);
$('#songbook-join').onsubmit=safeAction(async e=>{e.preventDefault();await joinSongbook($('#songbook-code').value);$('#songbook-code').value='';});
$('#songbook-share').onclick=safeAction(shareSongbook);$('#songbook-leave').onclick=safeAction(leaveSongbook);
all('#import-top,#import-side').forEach(b=>b.onclick=()=>$('#file-input').click());
$('#open-excerpt').onclick=safeAction(async()=>{closeDialogs();state.page=1;await openVisualExcerpt();});
$('#open-full').onclick=safeAction(async()=>{closeDialogs();state.page=1;await openFullTranscription();});
$('#file-input').onchange=safeAction(async e=>{for(const f of e.target.files)await importFile(f);e.target.value='';});
$('#xml-input').onchange=safeAction(async e=>{await importFile(e.target.files[0],true);e.target.value='';});
$('#attach-xml').onclick=()=>$('#xml-input').click();
for(const v of ['original','score','compare'])$('#view-'+v).onclick=safeAction(async()=>{state.view=v;closeDialogs();await render();});
$('#step-down').onclick=safeAction(()=>setTranspose(active().semitones-1));$('#step-up').onclick=safeAction(()=>setTranspose(active().semitones+1));$('#reset').onclick=safeAction(()=>setTranspose(0,active().info.fifths));
$('#target-key').onchange=safeAction(async e=>{const s=active(),f=Number(e.target.value);let n=mod((f-s.info.fifths)*7,12);if(n>6)n-=12;await setTranspose(n,f);});
for(const [selector,amount]of [['#zoom-in',10],['#zoom-out',-10]])$(selector).onclick=()=>zoomBy(amount);
$('#fit').onclick=()=>setFit('page');$('#fit-width').onclick=()=>setFit('width');$('#fit-page').onclick=()=>setFit('page');
$('#recognize').onclick=safeAction(recognizeMusic);$('#export-open').onclick=()=>{closeDialogs();openExport();};$('#review-open').onclick=()=>{closeDialogs();openReview();};$('#save-review').onclick=safeAction(saveReview);
$('#library-open').onclick=()=>openPanel('#library-dialog');$('#library-dialog').addEventListener('close',()=>{if(state.scores.some(s=>s.confirmRemove)){for(const s of state.scores)delete s.confirmRemove;renderLibrary();}});$('#transpose-open').onclick=()=>openPanel('#transpose-dialog');$('#tools-open').onclick=$('#source-open').onclick=()=>openPanel('#tools-dialog');
$('#library-search').oninput=filterLibrary;$('#page-prev').onclick=()=>turnPage(-1);$('#page-next').onclick=()=>turnPage(1);$('#focus-enter').onclick=()=>focusMode(true);$('#focus-exit').onclick=()=>focusMode(false);
all('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
all('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
window.addEventListener('resize',()=>requestAnimationFrame(applyZoom));
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.querySelector('dialog[open]'))focusMode(false);if(e.ctrlKey||e.metaKey||e.altKey||document.querySelector('dialog[open]')||e.target.matches('input,textarea,select'))return;const action={'ArrowRight':()=>turnPage(1),'ArrowLeft':()=>turnPage(-1),'+':()=>zoomBy(10),'=':()=>zoomBy(10),'-':()=>zoomBy(-10)}[e.key];if(action){e.preventDefault();action();}});
$('#reviewed').onchange=safeAction(async e=>{active().reviewed=e.target.checked;await persist(active());renderLibrary();renderControls();});
$('#download-original').onclick=()=>download(active().bytes,active().name+'.pdf','application/pdf');
$('#download-xml').onclick=safeAction(()=>{const s=active();if(s.recognized&&!s.reviewed)throw Error('Review the recognized score first.');download(currentXML(),exportName(s,'musicxml'),'application/vnd.recordare.musicxml+xml');});
$('#print-score').onclick=safeAction(async()=>{const s=active();if(s.recognized&&!s.reviewed)throw Error('Review the recognized score first.');$('#export-dialog').close();state.view='score';await render();await document.fonts.ready;window.print();});
let dragDepth=0;document.addEventListener('dragenter',e=>{if(e.dataTransfer?.types.includes('Files')){e.preventDefault();dragDepth++;document.body.classList.add('drop-active');}});document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('dragleave',()=>{if(--dragDepth<=0)document.body.classList.remove('drop-active');});document.addEventListener('drop',safeAction(async e=>{e.preventDefault();dragDepth=0;document.body.classList.remove('drop-active');for(const file of e.dataTransfer.files)await importFile(file);}));
async function init(){
 state.scores=await savedScores();
 const params=new URLSearchParams(location.search),joinCode=normalizeCode(params.get('library'));
 if(params.has('library')){params.delete('library');history.replaceState(null,'',location.pathname+(params.size?'?'+params:'')+location.hash);}
 renderSongbook();
 const code=joinCode||normalizeCode(localStorage.getItem(SONGBOOK_KEY));
 if(code){try{await connectSongbook(code);if(joinCode)toast('Joined the shared songbook.');}catch(e){console.error(e);toast(e.message);}}
 if(!state.scores.length&&!state.songbook){const response=await fetch('/samples/golden-lady.pdf');if(!response.ok)throw Error('The sample PDF could not be loaded. Import a PDF to begin.');const s={id:'golden-lady-sample',name:'Golden Lady',kind:'pdf',bytes:new Uint8Array(await response.arrayBuffer()),pages:2,scanned:true,reviewed:false,semitones:0};state.scores=[s];await persist(s);}
 if(state.scores.length){state.active=(state.scores.find(s=>s.visualFull)||state.scores[0]).id;state.view=hasBlob(active(),'xml')?'score':'original';}
 const requestedScore=params.get('score');
 if(requestedScore==='golden-lady-full')await openFullTranscription();else if(requestedScore==='ai-excerpt')await openVisualExcerpt();else{renderLibrary();await render();}
 if(document.modelContext?.registerTool){try{document.modelContext.registerTool({name:'transpose_active_score',title:'Transpose active score',description:'Change notes and chord symbols of the active editable score by semitones. Does not export or modify the original PDF.',inputSchema:{type:'object',properties:{semitones:{type:'integer',minimum:-24,maximum:24}},required:['semitones'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:async input=>{if(!input||Object.keys(input).some(k=>k!=='semitones'))throw Error('Invalid input');await setTranspose(input.semitones);return {title:active().name,semitones:active().semitones,targetKey:$('#target-key').selectedOptions[0].textContent};}});}catch(e){console.warn('WebMCP unavailable',e);}}
}
safeAction(init)();

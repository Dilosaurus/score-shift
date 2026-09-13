import './polyfills.mjs';
import * as pdfjs from './vendor/pdf.mjs';
import {unzipSync,strFromU8} from './vendor/fflate.mjs';
import DOMPurify from './vendor/purify.es.mjs';
import {parseScore,scoreInfo,transposeScore,chooseFifths,KEY_NAMES,mod} from './music.mjs';
import {chordKinds,addHarmony} from './chords.mjs';
import {engravingOptions,formatMusicXML,formatNotationSVG} from './engraving.mjs';
import {baseOptions,targetPages,fitLayout} from './layout.mjs';
import {createSongbook,connectFirestore,normalizeCode,reconcile,hasBlob} from './songbook.mjs';
import {createAuth,displayName,initials,isEmail} from './auth.mjs';
import {createDirectory,normalizeInvite,inviteLink as bandInviteLink,memberList,validBandName} from './bands.mjs';
import {catalog,catalogEntry,assetUrls,referenceScore,referenceId,isReference,searchCatalog,loadCatalogBooks,BOOKS} from './catalog.mjs';
import {parseMidi,harmonyPositions,planAccompaniment,measureOccurrences,measureNumbers,createPlayer} from './playback.mjs';
import {newList,listPayload,hasItem,addItem,removeItemAt,removeScoreFromList,moveItem,stripFromLists,resolveKey,entryKeyForStep,reconcileLists} from './sets.mjs';
import {GUEST_BAND,GUEST_KEY,bootMode,planBringIn,leftoverSentence} from './guest.mjs';
pdfjs.GlobalWorkerOptions.workerSrc='/pdf-worker.mjs';
const $=s=>document.querySelector(s),all=s=>[...document.querySelectorAll(s)];
const state={scores:[],active:null,view:'original',zoom:100,render:0,page:1,fit:'width',songbook:null,songbookReady:false,lists:[],listsReady:false,tab:'books',book:'all',openSet:null,set:null,user:null,directory:null,bands:[],band:null,bandDoc:null,members:{},stopBand:null,catalogBook:'',catalogQuery:'',drawerView:'library',guest:false,leftovers:null};
const SONGBOOK_KEY='scoreshift-songbook',BAND_KEY='scoreshift-band',CLAIMED_KEY='scoreshift-claimed';
let fb,db,auth,session;
// Where a kept chart goes, in words: the band by name, or this device for a guest.
const spaceName=()=>state.guest?'this device':(state.bandDoc?.name||'the band');
const keepLabel=()=>state.guest?'Keep on this device':`Add to ${state.bandDoc?.name||'band'}`;
const active=()=>state.scores.find(s=>s.id===state.active);
let enginePromise,dbPromise,toastTimer;
const apiBase=['127.0.0.1','localhost'].includes(location.hostname)?'':'http://127.0.0.1:5173';
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,6000);}
function notice(message,error=false){$('#notice').replaceChildren();$('#notice').classList.toggle('error',!!message&&error);if(!message)return;const text=document.createElement('span');text.textContent=message;$('#notice').append(text);}
function safeAction(fn){return async(...args)=>{try{await fn(...args);}catch(e){console.error(e);toast(e.message||'Something went wrong. Please try again.');}};}
function database(){return dbPromise??=new Promise((resolve,reject)=>{const req=indexedDB.open('scoreshift-device',3);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('scores'))db.createObjectStore('scores',{keyPath:'id'});if(!db.objectStoreNames.contains('lists'))db.createObjectStore('lists',{keyPath:'id'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function persistLocal(s){try{const db=await database();await new Promise((resolve,reject)=>{const tx=db.transaction('scores','readwrite');tx.objectStore('scores').put({...s,band:state.band,pdf:undefined,job:undefined,dirty:undefined,confirmRemove:undefined,fitLayout:undefined});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}catch{toast('This browser could not save the score. Keep this tab open or export your work.');}}
async function deleteLocal(id){try{const db=await database();await new Promise((resolve,reject)=>{const tx=db.transaction('scores','readwrite');tx.objectStore('scores').delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}catch{}}
async function persist(s){if(s.reviewPreview||s.preview)return;await persistLocal(s);if(!state.songbook)return;s.dirty=true;state.songbook.save(s).catch(e=>{console.error(e);songbookStatus('Could not save to the band. '+(e.message||'Try again.'),'error');}).finally(()=>{s.dirty=false;persistLocal(s);});}
async function savedScores(band=state.band){try{const db=await database();return await new Promise((resolve,reject)=>{const req=db.transaction('scores').objectStore('scores').getAll();req.onsuccess=()=>resolve(req.result.filter(r=>r&&r.band===band));req.onerror=()=>reject(req.error);});}catch{return [];}}
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
// A catalog chart in the band is a reference: metadata only, music fetched from hosting.
async function loadReference(s){
 const entry=catalogEntry(s.catalog);if(!entry)throw Error('This catalog chart is no longer published.');
 const urls=assetUrls(entry),jobs=[];
 if(!s.xml&&!hasBlob(s,'xml'))jobs.push(fetch(urls.xml).then(async r=>{if(!r.ok)throw Error('The chart could not be loaded from the catalog.');const bytes=new Uint8Array(await r.arrayBuffer());s.xml=unpackScore(bytes,urls.xml);s.info=scoreInfo(parseScore(s.xml));if(s.targetFifths==null)s.targetFifths=s.info.fifths;}));
 if(!s.bytes&&!hasBlob(s,'bytes'))jobs.push(fetch(urls.pdf).then(async r=>{if(!r.ok)throw Error('The source pages could not be loaded from the catalog.');s.bytes=new Uint8Array(await r.arrayBuffer());}));
 await Promise.all(jobs);if(!s.pages)s.pages=entry.pages||1;
 await persistLocal(s);
}
async function openCatalog(entry,{add=false,set=null,book=null}={}){
 const id=referenceId(entry);let s=state.scores.find(x=>x.id===id);const wasPreview=!!s?.preview;let added=false;
 if(!s){s=referenceScore(entry);if(!add)s.preview=true;state.scores.push(s);}
 if(add&&(s.preview||wasPreview)){delete s.preview;}
 if(add&&(!s.sync||wasPreview)){await persist(s);added=true;}
 if(set){if(addItem(set,s.id))await saveList(set);}
 if(book){if(addItem(book,s.id))await saveList(book);}
 if(add||set||book){renderLibrary();toast(set?`Added \u201c${entry.title}\u201d to ${set.name}.`:book?`Added \u201c${entry.title}\u201d to ${book.name}.`:added?(state.guest?`Kept \u201c${entry.title}\u201d on this device.`:`Added \u201c${entry.title}\u201d to ${spaceName()}.`):`\u201c${entry.title}\u201d is already ${state.guest?'on this device':'in the band'}.`);if(!added&&!set&&!book)return;if(add&&!set&&!book&&state.active===s.id){renderControls();return;}if(set||book)return;}
 dropPreviews(s.id);if(state.set)exitSet();closeDialogs();state.active=s.id;state.page=1;state.view='score';renderLibrary();await render();
}
// A small menu anchored to a row: sections of actions. One dialog, refilled per row.
function openRowMenu(anchor,sections){
 const menu=$('#row-menu'),box=$('#row-menu-items');box.replaceChildren();
 for(const section of sections){if(section.title){const h=document.createElement('div');h.className='head';h.textContent=section.title;box.append(h);}for(const item of section.items){const b=document.createElement('button');b.type='button';b.textContent=item.label;if(item.red)b.className='red';b.disabled=!!item.disabled;b.onclick=safeAction(async()=>{menu.close();await item.onClick();});box.append(b);}}
 const r=anchor.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(window.innerWidth-268,r.right-260))+'px';menu.style.top=Math.min(window.innerHeight-16,r.bottom+4)+'px';
 menu.showModal();
 requestAnimationFrame(()=>{const m=menu.getBoundingClientRect();if(m.bottom>window.innerHeight-8)menu.style.top=Math.max(8,r.top-m.height-4)+'px';});
}
function setSections(onPick){const sets=setLists();return{title:'Add to a setlist',items:sets.length?sets.map(set=>({label:set.name,onClick:()=>onPick(set)})):[{label:'No setlists yet',disabled:true,onClick:()=>{}}]};}
function bookSections(onPick,has=()=>false){const books=bookLists();return{title:'Binders',items:books.length?books.map(b=>({label:(has(b)?'\u2713 ':'')+b.name,onClick:()=>onPick(b)})):[{label:'No binders yet',disabled:true,onClick:()=>{}}]};}
// ?review=ID opens a temporary review copy of a transcription being checked (the queue page).
async function openTranscription(id,preview=false){
 if(!/^[a-z0-9-]+$/.test(id))throw Error('Unknown transcription.');
 if(!preview){const entry=catalogEntry(id);if(!entry)throw Error('Unknown transcription.');await openCatalog(entry);return;}
 const catalogList=await fetch('/real-book-review.json').then(r=>{if(!r.ok)throw Error('Review catalog unavailable.');return r.json();});
 const entry=catalogList.find(t=>t.id===id);if(!entry)throw Error('Unknown transcription.');
 const base='/review/real-book/'+id,scoreId='review-'+id;
 const [scoreResponse,pdfResponse]=await Promise.all([fetch(base+'.mxl'),fetch(base+'.pdf')]);
 if(!scoreResponse.ok||!pdfResponse.ok)throw Error('The transcription could not be loaded.');
 const xml=unpackScore(new Uint8Array(await scoreResponse.arrayBuffer()),id+'.mxl'),info=scoreInfo(parseScore(xml));
 let s=state.scores.find(x=>x.id===scoreId);
 const updated={id:scoreId,name:entry.title+' \u00b7 Review',reviewPreview:true,kind:'xml',xml,info,bytes:new Uint8Array(await pdfResponse.arrayBuffer()),pages:entry.pages||1,semitones:0,targetFifths:info.fifths,reviewed:false};
 if(s)Object.assign(s,updated);else{s=updated;state.scores.push(s);}
 if(state.set)exitSet();closeDialogs();state.active=s.id;state.page=1;state.view='score';renderLibrary();await render();
}
function bookLists(){return state.lists.filter(l=>l.kind==='book').sort((a,b)=>a.name.localeCompare(b.name));}
function setLists(){return state.lists.filter(l=>l.kind==='set').sort((a,b)=>a.name.localeCompare(b.name));}
function currentBook(){return state.lists.find(l=>l.id===state.book&&l.kind==='book')||null;}
function openSet(){return state.lists.find(l=>l.id===state.openSet&&l.kind==='set')||null;}
function bandScores(){return state.scores.filter(s=>!s.preview&&!s.reviewPreview);}
function dropPreviews(keep=null){for(const s of [...state.scores])if((s.preview||s.reviewPreview)&&s.id!==keep){state.scores.splice(state.scores.indexOf(s),1);if(state.active===s.id)state.active=null;}}
function visibleScores(){const book=currentBook();if(!book){state.book='all';return bandScores();}return book.items.map(i=>state.scores.find(s=>s.id===i.id)).filter(s=>s&&!s.preview);}
function scoreTitle(s){return s.visualFull?'Golden Lady':s.name;}
function keyLabel(s,fifths){return s.info?KEY_NAMES[fifths]?.[s.info.minor?1:0]+' '+(s.info.minor?'minor':'major'):'';}
function armed(button,text){if(button.dataset.armed==='true'){clearTimeout(button._disarm);button.dataset.armed='';button.textContent=button.dataset.label;return true;}button.dataset.label??=button.textContent;button.dataset.armed='true';button.textContent=text;clearTimeout(button._disarm);button._disarm=setTimeout(()=>{button.dataset.armed='';button.textContent=button.dataset.label;},6000);return false;}
function renderTabs(){$('#books-panel').hidden=state.tab!=='books';$('#sets-panel').hidden=state.tab!=='sets';$('#catalog-panel').hidden=state.tab!=='catalog';for(const t of ['books','sets','catalog']){$('#tab-'+t).classList.toggle('active',state.tab===t);$('#tab-'+t).setAttribute('aria-selected',String(state.tab===t));}}
function renderBooks(){
 const chips=$('#book-chips');chips.replaceChildren();
 const all=document.createElement('button');all.className='chip'+(state.book==='all'?' active':'');all.textContent='All charts';all.onclick=()=>{state.book='all';$('#book-rename-form').hidden=true;renderLibrary();};chips.append(all);
 for(const b of bookLists()){const chip=document.createElement('button');chip.className='chip'+(state.book===b.id?' active':'');chip.textContent=b.name;chip.title=`${b.items.length} chart${b.items.length===1?'':'s'}`;chip.onclick=()=>{state.book=b.id;$('#book-rename-form').hidden=true;renderLibrary();};chips.append(chip);}
 const add=document.createElement('button');add.className='chip ghost';add.textContent='+ Binder';add.onclick=()=>{$('#book-new').hidden=false;$('#book-new-name').focus();};chips.append(add);
 $('#book-tools').hidden=!currentBook();
 $('#library-list').dataset.empty=currentBook()?'This binder is empty. Open a chart, then add it here from its menu.':`No charts ${state.guest?'on this device':'in this band'} yet. Import a PDF or MusicXML file, or add charts from the Catalog tab.`;
}
function shortKey(s,fifths){if(!s.info)return '';const name=KEY_NAMES[fifths]?.[s.info.minor?1:0]||'';return s.info.minor?name+'m':name;}
function chartMeta(s){const book=s.book&&BOOKS.find(b=>b.id===s.book)?.title;if(s.catalog)return (book||'Catalog')+(s.userEdited?' \u00b7 edited by the band':'');if(hasBlob(s,'xml'))return s.recognized&&!s.reviewed?'Recognized \u00b7 needs review':`Imported \u00b7 ${s.info?.measures??'?'} measures`;return `PDF \u00b7 ${s.pages||'?'} page${s.pages===1?'':'s'}`;}
function renderLibrary(){
 renderTabs();renderBooks();renderDrawerView();
 $('#library-list').replaceChildren();$('#score-count').textContent=bandScores().length;
 visibleScores().forEach((s,i)=>{const row=document.createElement('div');row.className='score-item'+(s.id===state.active?' selected':'');
  if(s.confirmRemove){row.classList.add('confirming');const ask=document.createElement('div');ask.className='score-confirm';const q=document.createElement('span');q.textContent=`Remove \u201c${scoreTitle(s)}\u201d from ${state.guest?'this device':'the band'}?`;const yes=document.createElement('button');yes.className='button danger';yes.textContent='Remove';yes.onclick=safeAction(()=>removeScore(s));const no=document.createElement('button');no.className='button';no.textContent='Keep';no.onclick=()=>{delete s.confirmRemove;renderLibrary();};ask.append(q,yes,no);row.append(ask);$('#library-list').append(row);return;}
  const button=document.createElement('button');button.className='score-open';button.setAttribute('aria-pressed',String(s.id===state.active));
  const n=document.createElement('span');n.className='n';n.textContent=String(i+1).padStart(2,'0');
  const text=document.createElement('span'),title=document.createElement('strong'),sub=document.createElement('small');title.textContent=scoreTitle(s);sub.textContent=chartMeta(s)+(s.missing?.length?' \u00b7 downloading':'');text.append(title,sub);
  const key=document.createElement('span');if(s.info){key.className='key';key.textContent=shortKey(s,resolveKey(s,null).fifths);}else{key.className='tag g';key.textContent=s.catalog?'Catalog':'PDF';}
  button.append(n,text,key);button.onclick=safeAction(async()=>{dropPreviews();if(state.set)exitSet();state.active=s.id;state.page=1;state.view=hasBlob(s,'xml')?'score':'original';closeDialogs();renderLibrary();await render();});
  const more=document.createElement('button');more.className='row-more';more.textContent='\u22ef';more.setAttribute('aria-label',`Actions for ${scoreTitle(s)}`);more.onclick=()=>openRowMenu(more,[setSections(async set=>{if(addItem(set,s.id))await saveList(set);renderLibrary();toast(`Added \u201c${scoreTitle(s)}\u201d to ${set.name}.`);}),bookSections(async b=>{if(hasItem(b,s.id))removeScoreFromList(b,s.id);else addItem(b,s.id);await saveList(b);renderLibrary();},b=>hasItem(b,s.id)),{items:[{label:`Remove from ${state.guest?'this device':(state.bandDoc?.name||'band')}`,red:true,onClick:()=>{for(const other of state.scores)delete other.confirmRemove;s.confirmRemove=true;renderLibrary();row.querySelector('.button.danger')?.focus();}}]}]);
  row.append(button,more);$('#library-list').append(row);});
 filterLibrary();renderSets();renderOrganize();renderCatalog();renderBand();
}
function renderDrawerView(){$('#library-view').hidden=state.drawerView==='band';$('#band-view').hidden=state.drawerView!=='band';}
function renderCatalog(){
 const entries=catalog(),chips=$('#catalog-books');chips.replaceChildren();
 for(const book of [{id:'',title:'All books'},...BOOKS]){const n=book.id?entries.filter(e=>e.book===book.id).length:entries.length;const chip=document.createElement('button');chip.className='chip'+(state.catalogBook===book.id?' active':'');chip.textContent=book.title;chip.title=`${n} chart${n===1?'':'s'}`;chip.onclick=()=>{state.catalogBook=book.id;renderCatalog();};chips.append(chip);}
 const list=$('#catalog-list');list.replaceChildren();const shown=searchCatalog(entries,state.catalogQuery,state.catalogBook);
 for(const entry of shown){const id=referenceId(entry),inBand=bandScores().some(s=>s.id===id);const row=document.createElement('div');row.className='catalog-item';const open=document.createElement('button');open.className='catalog-open';const text=document.createElement('span'),title=document.createElement('strong'),sub=document.createElement('small');title.textContent=entry.title;sub.textContent=(BOOKS.find(b=>b.id===entry.book)?.title||'')+(entry.composer?` \u00b7 ${entry.composer}`:'')+(entry.page?` \u00b7 p. ${entry.page}`:'');text.append(title,sub);open.append(text);if(inBand){const tag=document.createElement('span');tag.className='tag';tag.textContent=state.guest?'On device':'In band';open.append(tag);}open.onclick=safeAction(()=>openCatalog(entry));
  const more=document.createElement('button');more.className='row-more';more.textContent='\u22ef';more.setAttribute('aria-label',`Actions for ${entry.title}`);more.onclick=()=>openRowMenu(more,[{items:[{label:inBand?(state.guest?'Already on this device':`Already in ${spaceName()}`):keepLabel(),disabled:inBand,onClick:()=>openCatalog(entry,{add:true})}]},setSections(set=>openCatalog(entry,{add:true,set})),bookSections(book=>openCatalog(entry,{add:true,book}))]);
  row.append(open,more);list.append(row);}
 $('#catalog-empty').hidden=!!shown.length;
}
// The guest reading of the Library head: no band, no members, a dashed empty seat for an avatar,
// and the account line offers sign-in. The band sub-view is never shown to a guest.
function renderGuestBand(){
 const n=bandScores().length,count=Object.assign(document.createElement('span'),{id:'score-count',textContent:n});
 $('#band-name').textContent='Not signed in';
 for(const id of ['band-avatar','account-avatar']){$('#'+id).textContent='';$('#'+id).classList.add('guest');}
 $('#band-meta').replaceChildren(count,document.createTextNode(` chart${n===1?'':'s'}`));
 $('#account-name').textContent='Guest';$('#band-settings-open').textContent='Sign in';
 $('#engine-status').textContent='';$('#device-charts').hidden=true;
 renderDrawerView();
}
function renderDeviceCharts(){
 const box=$('#device-charts'),left=state.leftovers;
 if(!left||state.guest||!(left.scores.length||left.lists.length)){box.hidden=true;return;}
 $('#device-charts-text').textContent=leftoverSentence(left.scores,left.lists);$('#device-charts-band').textContent=state.bandDoc?.name||'the band';box.hidden=false;
}
function renderBand(){
 if(state.guest){renderGuestBand();return;}
 for(const id of ['band-avatar','account-avatar'])$('#'+id).classList.remove('guest');$('#band-settings-open').textContent='Band settings';
 const band=state.bandDoc,name=band?.name||(state.band?'Band':'No band'),ini=initials(name);
 $('#band-name').textContent=name;$('#band-avatar').textContent=ini;$('#band-view-avatar').textContent=ini;$('#band-view-name').textContent=name;
 renderDeviceCharts();
 const uid=state.user?.uid,owner=band?.owner===uid,members=memberList(state.members),sets=setLists().length;
 const n=bandScores().length,count=Object.assign(document.createElement('span'),{id:'score-count',textContent:n});
 $('#band-meta').replaceChildren(count,document.createTextNode(` chart${n===1?'':'s'} \u00b7 ${members.length} member${members.length===1?'':'s'}`));
 $('#band-view-meta').textContent=`${members.length} member${members.length===1?'':'s'} \u00b7 ${n} chart${n===1?'':'s'} \u00b7 ${sets} setlist${sets===1?'':'s'}`;
 const box=$('#band-members');box.replaceChildren();
 for(const m of members){const row=document.createElement('div');row.className='member';const av=document.createElement('span');av.className='av g';av.textContent=initials(m.name);const who=document.createElement('span');who.className='who';who.textContent=m.name;if(m.uid===uid){const you=document.createElement('span');you.textContent=' (you)';who.append(you);}const role=document.createElement('span');if(m.role==='owner'){role.className='tag g';role.textContent='Owner';}row.append(av,who,role);if(owner&&m.uid!==uid){const x=document.createElement('button');x.className='member-remove';x.textContent='\u00d7';x.title='Remove from band';x.setAttribute('aria-label',`Remove ${m.name} from the band`);x.onclick=safeAction(async()=>{if(!armed(x,'?'))return;await state.directory.removeMember(state.band,m.uid);toast(`Removed ${m.name} from ${name}.`);});row.append(x);}else row.append(document.createElement('span'));box.append(row);}
 const bands=$('#band-chips');bands.replaceChildren();
 for(const b of state.bands){const row=document.createElement('button');row.className='band-row'+(b.id===state.band?' current':'');const av=document.createElement('span');av.className='av sm'+(b.id===state.band?'':' g');av.textContent=initials(b.name);const label=document.createElement('span');label.textContent=b.name;row.append(av,label);if(b.id===state.band){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','icon');svg.setAttribute('aria-hidden','true');const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#i-check');svg.append(use);row.append(svg);}else row.append(document.createElement('span'));row.onclick=safeAction(()=>switchBand(b.id));bands.append(row);}
 $('#band-invite').disabled=!band?.invite;$('#band-rename').hidden=!owner;$('#band-new-invite-wrap').hidden=!owner;$('#band-leave').hidden=owner||!state.band;$('#band-delete').hidden=!owner||!state.band;
 const who=state.user?displayName(state.user):'',mail=state.user?.email?` \u00b7 ${state.user.email}`:'';
 $('#account-name').textContent=who;$('#account-avatar').textContent=initials(who);$('#band-view-account-avatar').textContent=initials(who);$('#band-view-account').textContent=who+mail;
 $('#engine-status').textContent=state.songbook||!state.band?'':'Could not reach the band. Working from this device until it reconnects.';
 renderDrawerView();
}
function renderSets(){
 const set=openSet();$('#sets-home').hidden=!!set;$('#set-detail').hidden=!set;
 if(!set){const list=$('#set-list');list.replaceChildren();const sets=setLists();$('#sets-empty').hidden=!!sets.length;for(const l of sets){const row=document.createElement('button');row.className='set-row'+(state.set?.listId===l.id?' selected':'');const text=document.createElement('span'),title=document.createElement('strong'),sub=document.createElement('small');title.textContent=l.name;sub.textContent=`${l.items.length} chart${l.items.length===1?'':'s'}`;text.append(title,sub);const tag=document.createElement('span');if(state.set?.listId===l.id){tag.className='tag';tag.textContent='Playing';}const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','icon');svg.setAttribute('aria-hidden','true');const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#i-right');svg.append(use);row.append(text,tag,svg);row.onclick=()=>{state.openSet=l.id;renderLibrary();};list.append(row);}return;}
 if(document.activeElement!==$('#set-name'))$('#set-name').value=set.name;
 $('#set-play').disabled=!set.items.length;$('#set-play').textContent=state.set?.listId===set.id?'Playing this setlist':'Play setlist';
 const songs=$('#set-songs');songs.replaceChildren();
 const reorder=async(from,to)=>{const current=state.set?.listId===set.id?set.items[state.set.index]:null;if(!moveItem(set,from,to))return;if(current){state.set.index=set.items.indexOf(current);renderSetBar();}await saveList(set);renderLibrary();};
 set.items.forEach((item,i)=>{
  const s=state.scores.find(x=>x.id===item.id),row=document.createElement('div');row.className='set-song'+(state.set?.listId===set.id&&state.set.index===i?' current':'');
  const n=document.createElement('span');n.className='n';n.textContent=String(i+1).padStart(2,'0');
  const title=document.createElement('button');title.className='title';const strong=document.createElement('strong'),small=document.createElement('small');strong.textContent=s?scoreTitle(s):'Chart no longer in the band';const key=s?resolveKey(s,item):null;small.textContent=s?(hasBlob(s,'xml')?(key.fromSet?'Setlist key':'Chart key'):'PDF only'):'';title.append(strong,small);title.onclick=safeAction(()=>playSet(set.id,i));title.disabled=!s;
  const controls=document.createElement('div');controls.className='controls';
  if(s&&hasBlob(s,'xml')){const select=document.createElement('select');select.className='kp'+(item.fifths==null?'':' set');select.setAttribute('aria-label',`Key for ${scoreTitle(s)} in this setlist`);const own=document.createElement('option');own.value='';own.textContent=shortKey(s,s.targetFifths??s.info.fifths);select.append(own);for(const [fifths,names] of Object.entries(KEY_NAMES).sort((a,b)=>Number(a[0])-Number(b[0]))){const o=document.createElement('option');o.value=fifths;o.textContent=s.info.minor?names[1]+'m':names[0];select.append(o);}select.value=item.fifths==null?'':String(item.fifths);select.onchange=safeAction(async e=>{if(e.target.value==='')delete item.fifths;else item.fifths=Number(e.target.value);await saveList(set);renderLibrary();if(state.set?.listId===set.id&&state.set.index===i)await render();});controls.append(select);}
  const remove=document.createElement('button');remove.className='plain-button';remove.textContent='\u00d7';remove.setAttribute('aria-label','Remove from setlist');remove.onclick=safeAction(async()=>{removeItemAt(set,i);if(state.set?.listId===set.id){if(!set.items.length)exitSet();else{state.set.index=Math.min(state.set.index>i?state.set.index-1:state.set.index,set.items.length-1);renderSetBar();}}await saveList(set);renderLibrary();});controls.append(remove);
  const handle=document.createElement('button');handle.className='drag-handle';handle.title='Drag to reorder';handle.setAttribute('aria-label',`Move ${s?scoreTitle(s):'chart'}: drag, or use the arrow keys`);const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','icon');svg.setAttribute('aria-hidden','true');const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#i-drag');svg.append(use);handle.append(svg);
  handle.onpointerdown=()=>{row.dataset.armed='1';};handle.onkeydown=safeAction(async e=>{if(e.key==='ArrowUp'&&i>0){e.preventDefault();await reorder(i,i-1);$('#set-songs').children[i-1]?.querySelector('.drag-handle')?.focus();}else if(e.key==='ArrowDown'&&i<set.items.length-1){e.preventDefault();await reorder(i,i+1);$('#set-songs').children[i+1]?.querySelector('.drag-handle')?.focus();}});
  row.draggable=true;row.ondragstart=e=>{if(row.dataset.armed!=='1'){e.preventDefault();return;}e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(i));row.classList.add('dragging');};row.ondragend=()=>{row.dataset.armed='';row.classList.remove('dragging');for(const r of all('#set-songs .set-song'))r.classList.remove('drop-before','drop-after');};
  row.ondragover=e=>{e.preventDefault();e.dataTransfer.dropEffect='move';const r=row.getBoundingClientRect(),before=e.clientY<r.top+r.height/2;row.classList.toggle('drop-before',before);row.classList.toggle('drop-after',!before);};row.ondragleave=()=>row.classList.remove('drop-before','drop-after');
  row.ondrop=safeAction(async e=>{e.preventDefault();const from=Number(e.dataTransfer.getData('text/plain'));const r=row.getBoundingClientRect(),before=e.clientY<r.top+r.height/2;let to=i+(before?0:1);if(from<to)to--;row.classList.remove('drop-before','drop-after');if(Number.isInteger(from)&&from!==to)await reorder(from,to);});
  row.append(n,title,controls,handle);songs.append(row);
 });
 const select=$('#set-add-select');select.replaceChildren();for(const s of bandScores().sort((a,b)=>scoreTitle(a).localeCompare(scoreTitle(b)))){const o=document.createElement('option');o.value=s.id;o.textContent=scoreTitle(s);select.append(o);}$('#set-add-button').disabled=!bandScores().length;
}
function renderOrganize(){
 const s=active(),toggles=$('#book-toggles');toggles.replaceChildren();const books=bookLists();
 if(!books.length){const p=document.createElement('span');p.className='caption';p.textContent='No binders yet. Make one from the Charts tab.';toggles.append(p);}
 else if(s)for(const b of books){const on=hasItem(b,s.id);const chip=document.createElement('button');chip.className='chip'+(on?' checked':'');chip.textContent=(on?'✓ ':'')+b.name;chip.setAttribute('aria-pressed',String(on));chip.onclick=safeAction(async()=>{if(on)removeScoreFromList(b,s.id);else addItem(b,s.id);await saveList(b);renderLibrary();});toggles.append(chip);}
 const select=$('#add-set-select');select.replaceChildren();const sets=setLists();for(const set of sets){const o=document.createElement('option');o.value=set.id;o.textContent=set.name;select.append(o);}if(!sets.length){const o=document.createElement('option');o.value='';o.textContent='No setlists yet';select.append(o);}$('#add-set-button').disabled=!sets.length||!s;
}
const KEY_ORDER=[0,-5,2,-3,4,-1,-6,1,-4,3,-2,5];
function renderKeyGrid(s,key,editable){
 const grid=$('#key-grid');grid.replaceChildren();if(!editable)return;
 const pc=f=>mod(f*7,12),chartPc=pc(s.info.fifths),playPc=pc(key.fifths);
 for(const fifths of KEY_ORDER){const b=document.createElement('button');const isChart=pc(fifths)===chartPc,isPlaying=pc(fifths)===playPc;b.className=isPlaying?'on':isChart?'orig':'';b.type='button';b.textContent=KEY_NAMES[fifths][s.info.minor?1:0]+(s.info.minor?'m':'');if(isChart||isPlaying){const small=document.createElement('small');small.textContent=isPlaying?'Playing':'Chart';b.append(small);}b.setAttribute('aria-pressed',String(isPlaying));
  b.onclick=safeAction(async()=>{const target=isChart?s.info.fifths:fifths;let n=mod((target-s.info.fifths)*7,12);if(n>6)n-=12;await setTranspose(n,target);});grid.append(b);}
}
function renderControls(){
 const s=active();if(!s)return;
 const key=resolveKey(s,setEntry(s)),semis=key.semitones,set=setEntry(s)?playing():null,book=s.book&&BOOKS.find(b=>b.id===s.book)?.title;
 $('#preview-actions').hidden=!s.preview;$('.organize').hidden=!!s.preview;$('#add-to-band').replaceChildren(document.createTextNode(keepLabel()));$('#score-title').textContent=scoreTitle(s);$('#score-subtitle').textContent=s.preview?'Catalog preview'+(book?` \u00b7 ${book}`:''):set?`${set.name} \u00b7 ${state.set.index+1} of ${set.items.length}`:book?book+(s.composer?` \u00b7 ${s.composer}`:''):s.composer?s.composer:s.recognized?'Recognized \u00b7 needs review':s.xml?'Editable chart':'Original PDF';
 const editable=hasBlob(s,'xml'),hasPdf=hasBlob(s,'bytes');$('#original-key').textContent=editable?s.info.keyName:'awaiting recognition';
 $('#transpose-scope').textContent=set?`Playing ${set.name}. This key is for this setlist only; the chart keeps its own key.`:'Melody and chord symbols move together. The original PDF never changes.';$('#transpose-scope').classList.toggle('scope-note',!!set);$('#reset').textContent=set?'Use chart key':'Back to chart key';
 $('#current-key').textContent=editable?shortKey(s,key.fifths):'\u2014';$('#current-semis').textContent=semis?(semis>0?'+'+semis:String(semis)):'';$('#transpose-open').disabled=!editable;$('#transpose-open').classList.toggle('changed',!!semis);$('#source-label').textContent=state.view==='original'?'Original PDF':state.view==='compare'?'Compare':'Chart';
 $('#target-key').replaceChildren();if(editable){for(const [fifths,names] of Object.entries(KEY_NAMES).sort((a,b)=>Number(a[0])-Number(b[0]))){const option=document.createElement('option');option.value=fifths;option.textContent=names[s.info.minor?1:0]+' '+(s.info.minor?'minor':'major');$('#target-key').append(option);}$('#target-key').value=key.fifths;}else{const o=document.createElement('option');o.textContent='Choose a key';$('#target-key').append(o);}
 renderKeyGrid(s,key,editable);
 for(const selector of ['#target-key','#step-down','#step-up','#reset'])$(selector).disabled=!editable;
 $('#step-down').disabled=!editable||semis<=-24;$('#step-up').disabled=!editable||semis>=24;$('#reset').disabled=!editable||!semis;
 $('#semitones').textContent=semis>0?'+'+semis:semis||0;$('#interval-caption').replaceChildren(document.createTextNode(editable?(semis?`Playing in ${s.info.minor?KEY_NAMES[key.fifths][1]+' minor':KEY_NAMES[key.fifths][0]+' major'}, ${Math.abs(semis)} semitone${Math.abs(semis)===1?'':'s'} ${semis>0?'up':'down'} from the chart key `:'At the chart key '):'Chart key '),Object.assign(document.createElement('strong'),{id:'original-key',textContent:editable?s.info.keyName:'awaiting recognition'}));
 $('#view-original').disabled=!hasPdf;$('#view-score').disabled=!editable;$('#view-compare').disabled=!editable||!hasPdf;
 ['original','score','compare'].forEach(v=>{const b=$('#view-'+v);b.classList.toggle('active',state.view===v);b.setAttribute('aria-pressed',String(state.view===v));});
 $('#recognize').hidden=editable||!hasPdf;$('#recognize').disabled=!!s.job;$('#recognize').textContent=s.job?'Recognizing\u2026':'Recognize music';$('#recognize').classList.toggle('busy',!!s.job);
 $('#attach-xml').querySelector('strong').textContent=editable?'Replace editable MusicXML':'Import matching MusicXML';
 $('#import-title').textContent=s.job?'Reading the music\u2026':editable?s.recognized?'Review required':'Chart ready':s.scanned?'Scan imported':'PDF imported';
 $('#import-description').textContent=s.job?s.job.stage:editable?`${s.info.measures} measures \u00b7 ${s.info.notes} notes \u00b7 ${s.info.chords} chord symbols`+(book?` \u00b7 ${book}`:'')+(s.recognized?'. Check notes, rhythms, and missing chords against the original.':''):`${s.pages||'?'} page${s.pages===1?'':'s'} preserved. Recognition turns the printed notes into an editable chart.`;
 $('#recognition-caption').textContent=s.visualFull?'Transcribed visually from the complete scan, including lyrics, repeats, endings, and key changes.':s.recognized?`${s.warnings||0} engine warnings. Recognition is a draft, not a verified transcription.`:'';
 $('#review-actions').hidden=!editable;$('#reviewed').checked=!!s.reviewed;
 $('#review-actions .review-check').hidden=!s.recognized;
 $('#document-status').textContent=state.view==='original'?`${s.pages} page${s.pages===1?'':'s'} \u00b7 original PDF, unchanged`:`${s.info?.measures||0} measures \u00b7 ${state.view==='compare'?'compare':semis?'transposed':'original notation'}`;
 if(s.reviewPreview)notice('Review copy. This transcription is being checked; changes here are temporary and do not reach the band.',true);
 else if(s.preview)notice(state.guest?'Catalog preview. Keep it on this device to set its key or put it in a setlist.':'Catalog preview. Add it to the band to keep it, set its key, or put it in a setlist.');
 else if(s.job)notice('Recognizing the scan locally. This can take a few minutes. You can keep viewing the original.');
 else if(s.recognized&&!s.reviewed)notice(s.info.chords===0?'No chord symbols were recovered. Add missing chords in Review notes & chords, and check the recognized melody before exporting.':'Recognition needs review. Check pitches, rhythms, key signatures, repeats, and missing chord symbols before exporting.',true);
 else notice('');
 renderOrganize();renderPlayUI();
}
function renderEmpty(){state.render++;document.body.classList.add('empty');$('#empty-state').hidden=false;$('#empty-band').textContent=state.guest?'Not signed in':(state.bandDoc?.name||'');$('#score-title').textContent='No chart open';$('#score-subtitle').textContent='Open the library to pick a chart';$('#current-key').textContent='\u2014';$('#current-semis').textContent='';$('#transpose-open').classList.remove('changed');$('#pdf-pages').replaceChildren();$('#notation-pages').replaceChildren();$('#transpose-open').disabled=true;$('#page-label').textContent='0 / 0';$('#page-prev').disabled=$('#page-next').disabled=true;$('#reader-loading').hidden=true;$('#canvas-area').classList.remove('loading');}
async function render(){
 stopPlayback();play.plan=null;play.preparedFor=null;
 const s=active();if(!s){renderEmpty();return;}const epoch=++state.render;
 if(s.missing?.length){$('#reader-loading').hidden=false;try{await state.songbook?.fetchBlobs(s);}catch(e){console.error(e);toast(e.message);}if(epoch!==state.render)return;await persistLocal(s);renderLibrary();}
 if(s.catalog&&((!s.xml&&!hasBlob(s,'xml'))||(!s.bytes&&!hasBlob(s,'bytes')))){$('#reader-loading').hidden=false;try{await loadReference(s);}catch(e){console.error(e);toast(e.message);}if(epoch!==state.render)return;renderLibrary();}
 document.body.classList.remove('empty');$('#empty-state').hidden=true;renderControls();$('#canvas-area').classList.toggle('compare',state.view==='compare');$('#original-pane').hidden=state.view==='score';$('#editable-pane').hidden=state.view==='original';$('#reader-loading').hidden=false;$('#canvas-area').classList.add('loading');
 try{
 if(state.view!=='score'){
  const doc=await loadPdf(s);if(epoch!==state.render)return;const target=$('#pdf-pages');target.replaceChildren();
  for(let p=1;p<=doc.numPages;p++){const page=await doc.getPage(p);if(epoch!==state.render)return;const viewport=page.getViewport({scale:1}),scale=Math.min(2,1500/viewport.width);const v=page.getViewport({scale});const paper=document.createElement('div');paper.className='paper';paper.style.width=state.zoom+'%';const canvas=document.createElement('canvas');canvas.width=v.width;canvas.height=v.height;canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`${s.name}, original PDF page ${p} of ${doc.numPages}`);paper.append(canvas);target.append(paper);await page.render({canvasContext:canvas.getContext('2d'),viewport:v}).promise;if(epoch!==state.render)return;}
 }
 if(state.view!=='original')await renderNotation(s,epoch);
 if(epoch===state.render)updatePages();
 }finally{if(epoch===state.render){$('#reader-loading').hidden=true;$('#canvas-area').classList.remove('loading');}}
}
function currentXML(s=active()){const key=resolveKey(s,setEntry(s));return formatMusicXML(transposeScore(s.xml,key.semitones,key.fifths));}
function engravingXML(xml){
 // Verovio currently prints hidden degrees in addition to the custom chord label.
 // Respect their display flag in this render-only copy; exports retain the harmony data.
 const doc=parseScore(xml);
 for(const degree of doc.querySelectorAll('harmony > degree[print-object="no"]'))degree.remove();
 return new XMLSerializer().serializeToString(doc);
}
async function renderNotation(s,epoch=state.render){
 const vrv=await toolkit();if(epoch!==state.render)return;
 const data=engravingXML(currentXML(s)),base=baseOptions(engravingOptions,s),target=targetPages(s),fitKey=target&&`${target}|${data.length}|${s.targetFifths}|${s.semitones}`;
 let options=base;
 if(target){if(s.fitLayout?.key!==fitKey){const fit=fitLayout(base,target,o=>{vrv.resetOptions();vrv.setOptions(o);return vrv.loadData(data)?vrv.getPageCount():Infinity;});s.fitLayout={key:fitKey,options:fit.options,scale:fit.scale,fits:fit.fits};}options=s.fitLayout.options;}
 vrv.resetOptions();vrv.setOptions(options);
 if(!vrv.loadData(data))throw Error('The recognized notation could not be engraved. Review or replace the MusicXML file.');
 const pages=vrv.getPageCount();if(!pages)throw Error('No notation pages were produced.');
 $('#notation-pages').replaceChildren();for(let i=1;i<=pages;i++){const paper=document.createElement('div');paper.className='paper';paper.innerHTML=DOMPurify.sanitize(formatNotationSVG(vrv.renderToSVG(i),{fixedSystems:s.visualFull,page:i,pageCount:pages}),{USE_PROFILES:{svg:true,svgFilters:true},ADD_TAGS:['use'],ADD_ATTR:['viewBox','xlink:href']});paper.setAttribute('aria-label',`${s.name}, editable page ${i}`);$('#notation-pages').append(paper);}
}
function closeDialogs(){all('dialog[open]').forEach(d=>d.close());}
function openPanel(id){closeDialogs();$(id).showModal();}
function filterLibrary(){const q=$('#library-search').value.toLowerCase().trim();let count=0;all('#library-list .score-item').forEach(b=>{b.hidden=!(b.querySelector('.score-open')?.textContent||b.textContent).toLowerCase().includes(q);if(!b.hidden)count++;});$('#library-empty').hidden=!!count||!all('#library-list .score-item').length;}
function pageCount(){const targets=state.view==='compare'?['#pdf-pages','#notation-pages']:[state.view==='original'?'#pdf-pages':'#notation-pages'];return Math.max(1,...targets.map(t=>$(t).children.length));}
function updatePages(){
 const count=pageCount();state.page=Math.min(count,Math.max(1,state.page));
 for(const t of ['#pdf-pages','#notation-pages'])[...$(t).children].forEach((p,i)=>p.dataset.current=String(i===state.page-1));
 const set=playing();$('#page-label').textContent=`${state.page} / ${count}`;$('#page-prev').disabled=state.page<=1&&!(set&&state.set.index>0);$('#page-next').disabled=state.page>=count&&!(set&&state.set.index<set.items.length-1);$('#page-next').title=set&&state.page>=count?'Next chart in set':'';$('#page-prev').title=set&&state.page<=1?'Previous chart in set':'';
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
function turnPage(amount){const set=playing();if(set&&amount>0&&state.page>=pageCount()&&state.set.index<set.items.length-1){safeAction(()=>goToSetIndex(state.set.index+1,true))();return;}if(set&&amount<0&&state.page<=1&&state.set.index>0){safeAction(()=>goToSetIndex(state.set.index-1,false))();return;}const before=state.page;state.page+=amount;updatePages();if(before!==state.page)$('#canvas-area').scrollTo(0,0);}
function zoomBy(amount){state.zoom=Math.min(240,Math.max(50,state.zoom+amount));applyZoom();}
function setFit(mode){state.fit=mode;state.zoom=100;applyZoom();$('#canvas-area').scrollTo(0,0);}
function focusMode(on){closeDialogs();document.body.classList.toggle('focus-mode',on);$('#focus-exit').hidden=!on;requestAnimationFrame(applyZoom);}
async function setTranspose(n,target){
 const s=active();if(!s?.xml)throw Error('Recognize the PDF or import MusicXML first.');if(!Number.isInteger(n)||n<-24||n>24)throw Error('Choose -24 to +24 semitones.');
 const entry=setEntry(s);if(entry){entry.fifths=entryKeyForStep(s,n,target);if(state.view==='original')state.view='score';await render();await saveList(playing());renderLibrary();return;}
 s.semitones=n;s.targetFifths=target??chooseFifths(s.info.fifths,n);if(state.view==='original')state.view='score';await render();await persist(s);
}
async function resetTranspose(){const s=active(),entry=setEntry(s);if(entry){delete entry.fifths;await render();await saveList(playing());renderLibrary();return;}await setTranspose(0,s.info.fifths);}
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
function exportName(s,extension){return s.name.replace(/[<>:"/\\|?*]/g,'-')+(s.xml?' - '+keyLabel(s,resolveKey(s,setEntry(s)).fifths):'')+'.'+extension;}
function openExport(){const s=active();$('#export-intro').textContent=s?scoreTitle(s)+(s.xml?`, in ${keyLabel(s,resolveKey(s,setEntry(s)).fifths)}.`:'.'):'';$('#download-original').disabled=!s?.bytes;const locked=!s?.xml||(s.recognized&&!s.reviewed);$('#download-xml').disabled=locked;$('#print-score').disabled=locked;$('#download-pdf').disabled=locked;$('#export-warning').textContent=locked&&s?.xml?'Compare the recognized score with the original, correct any mistakes, then check “I’ve checked the recognized score” to export.':!s?.xml?'Recognize the PDF or import MusicXML to export transposed notation.':'';$('#export-dialog').showModal();}
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
 const s=active(),area=$('#xml-review');if(s.preview){delete s.preview;}let xml;reviewDoc=parseScore(s.xml);
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
 for(const list of stripFromLists(state.lists,s.id))await saveList(list);if(state.set){const set=playing();if(!set?.items.length)exitSet();else state.set.index=Math.min(state.set.index,set.items.length-1);}
 if(state.songbook)state.songbook.remove(s.id).catch(e=>{console.error(e);toast('Could not remove it from the band. '+(e.message||''));});
 if(state.active===s.id){if(state.scores.length){state.active=state.scores[0].id;state.page=1;state.view=hasBlob(active(),'xml')?'score':'original';await render();}else{state.active=null;renderEmpty();}}
 renderLibrary();toast(`Removed “${name}”.`);
}
function songbookStatus(text,kind='ok'){$('#songbook-status').textContent=text;$('.songbook-state').className='songbook-state '+kind;}
async function prefetchMissing(){for(const s of [...state.scores]){if(!state.songbook)return;if(s.missing?.length&&s.id!==state.active){try{await state.songbook.fetchBlobs(s);await persistLocal(s);renderLibrary();}catch(e){console.error(e);}}}}
function onSongbookChange(changes,remoteIds){
 const {fetch,removed,added,updated}=reconcile(state.scores,changes);
 for(const id of removed)deleteLocal(id);
 for(const id of [...added,...updated]){const s=state.scores.find(x=>x.id===id);if(s)persistLocal(s);}
 if(!state.songbookReady){
  state.songbookReady=true;
  for(const s of [...state.scores]){if(remoteIds.includes(s.id)||s.reviewPreview||s.preview)continue;if(s.sync){state.scores.splice(state.scores.indexOf(s),1);deleteLocal(s.id);if(s.id===state.active)state.active=null;}else persist(s);}
  prefetchMissing();
 }
 const activeGone=removed.includes(state.active)||!active();
 if(activeGone){if(state.scores.length){state.active=state.scores[0].id;state.page=1;state.view=hasBlob(active(),'xml')?'score':'original';safeAction(render)();}else{state.active=null;renderEmpty();}}
 else if(fetch.includes(state.active)||updated.includes(state.active))safeAction(render)();
 renderLibrary();
}
// Open a band: stop the previous one, load this band's device cache, then subscribe.
async function connectBand(id){
 stopPlayback();if(state.set)exitSet();
 state.songbook?.stop();state.stopBand?.();state.songbook=null;state.stopBand=null;state.songbookReady=false;state.listsReady=false;
 state.band=id;state.bandDoc=state.bands.find(b=>b.id===id)||null;state.members={};state.active=null;state.book='all';state.openSet=null;
 localStorage.setItem(BAND_KEY,id);
 state.scores=await savedScores();state.lists=(await savedLists()).filter(l=>l&&l.id&&Array.isArray(l.items));
 if(state.scores.length){state.active=state.scores[0].id;state.view=hasBlob(active(),'xml')?'score':'original';}
 renderLibrary();
 state.stopBand=state.directory.watchBand(id,{
  onBand:band=>{if(!band){songbookStatus('This band no longer exists.','error');return;}state.bandDoc=band;const known=state.bands.find(b=>b.id===id);if(known)Object.assign(known,band);renderBand();if(active())renderControls();else $('#empty-band').textContent=band.name;},
  onMembers:members=>{state.members=members;if(state.user&&!members[state.user.uid]&&Object.keys(members).length){songbookStatus('You were removed from this band.','error');}renderBand();}
 });
 const songbook=createSongbook({band:id,sdk:fb,onChange:onSongbookChange,onLists:onListsChange,onStatus:songbookStatus});state.songbook=songbook;
 try{await songbook.connect();}catch(e){console.error(e);songbook.stop();if(state.songbook===songbook)state.songbook=null;renderBand();throw Error(e.code==='permission-denied'?'You are not a member of this band any more.':'Could not reach the band. Check your connection; this device keeps working until it reconnects.');}
 state.directory.setCurrent(id).catch(console.error);
 renderBand();
}
async function switchBand(id){if(id===state.band)return;closeDialogs();await connectBand(id);if(state.scores.length)await render();else renderEmpty();toast(`Opened ${state.bandDoc?.name||'band'}.`);}
async function refreshBands(){const {bands,currentBand}=await state.directory.myBands();state.bands=bands;renderBand();return currentBand;}
async function joinBandFlow(text){
 const band=await state.directory.joinBand(text,displayName(state.user));
 await refreshBands();await connectBand(band.id);if(state.scores.length)await render();else renderEmpty();
 toast(`Joined ${band.name}.`);
}
async function createBandFlow(name){
 const band=await state.directory.createBand(name,displayName(state.user));
 await refreshBands();await connectBand(band.id);renderEmpty();toast(`Started ${band.name}. Invite your bandmates from the Band section.`);
}
async function inviteBandmate(){
 const code=state.bandDoc?.invite;if(!code)throw Error('The invite link is not ready yet.');
 const url=bandInviteLink(code),name=state.bandDoc.name;
 if(navigator.share){try{await navigator.share({title:`Join ${name} on ScoreShift`,text:`Join ${name} on ScoreShift to play from the same charts.`,url});return;}catch(e){if(e.name==='AbortError')return;}}
 await navigator.clipboard.writeText(url);toast('Invite link copied. Send it to whoever should join the band.');
}
$('#band-invite').onclick=safeAction(inviteBandmate);
$('#band-join').onsubmit=safeAction(async e=>{e.preventDefault();const text=$('#band-join-code').value;$('#band-join-code').value='';await joinBandFlow(text);document.querySelector('.songbook-switch').open=false;});
$('#band-create').onsubmit=safeAction(async e=>{e.preventDefault();const name=validBandName($('#band-create-name').value);$('#band-create-name').value='';await createBandFlow(name);document.querySelector('.songbook-switch').open=false;});
$('#band-rename').onclick=()=>{$('#band-rename-form').hidden=false;$('#band-rename-name').value=state.bandDoc?.name||'';$('#band-rename-name').focus();};
$('#band-rename-form').onsubmit=safeAction(async e=>{e.preventDefault();$('#band-rename-form').hidden=true;const name=validBandName($('#band-rename-name').value);if(name!==state.bandDoc?.name){await state.directory.renameBand(state.band,name);await refreshBands();toast(`Renamed to ${name}.`);}});
$('#band-new-invite').onclick=safeAction(async()=>{if(!armed($('#band-new-invite'),'Tap again: the old link stops working'))return;await state.directory.rotateInvite(state.band);toast('New invite link ready. Older links no longer work.');});
$('#band-leave').onclick=safeAction(async()=>{if(!armed($('#band-leave'),'Tap again to leave this band'))return;const leaving=state.band,name=state.bandDoc?.name||'the band';await state.directory.leaveBand(leaving);const current=await refreshBands();if(current){await connectBand(current);if(state.scores.length)await render();else renderEmpty();}else{const fresh=await startPersonalSpace();await connectBand(fresh);renderEmpty();}toast(`Left ${name}.`);});
$('#sign-out').onclick=safeAction(async()=>{await auth.signOut();localStorage.removeItem(BAND_KEY);location.reload();});
// ---- Sign-in screen ----
function welcomeStep(step){const dialog=$('#welcome-dialog');$('#welcome-signin').hidden=step!=='signin';if(step){if(!dialog.open){closeDialogs();dialog.showModal();}}else if(dialog.open)dialog.close();}
function signinStatus(text,error=false){$('#signin-status').textContent=text;$('#signin-status').classList.toggle('error',error);}
// The sign-in screen. Resolves {user} once someone signs in, {guest:true} when they take the guest
// door, or {cancelled:true} when a guest who opened it later closes it. A pending band invite hides
// the guest door: the invite is why they are here, and joining needs an account.
async function askSignIn({pendingLink=false,rememberedEmail='',redirectError=null}={},{guestDoor=true,pendingJoin=false,cancellable=false}={}){
 const dialog=$('#welcome-dialog');dialog.toggleAttribute('data-locked',!cancellable);
 $('#signin-guest').hidden=!guestDoor||cancellable;$('#signin-later').hidden=!cancellable;
 $('#signin-guest-note').textContent=cancellable?'Charts on this device stay here until you sign in.':'Browse the catalog and import charts. They stay on this device until you sign in.';
 $('.welcome-guest').hidden=!guestDoor&&!cancellable;
 $('#signin-caption').textContent=pendingJoin?'Sign in to join the band that invited you. Its charts, binders, setlists, and keys then follow you to every device.':'Sign in once. Your band\u2019s charts, binders, setlists, and keys follow you to every device.';
 welcomeStep('signin');
 if(redirectError)signinStatus(redirectError.message||'Google sign-in did not complete. Try again.',true);
 if(pendingLink){
  if(rememberedEmail){try{const u=await auth.completeEmailLink(rememberedEmail);if(u)return{user:u};}catch(e){console.error(e);signinStatus(e.message,true);}}
  $('#signin-email').hidden=true;$('#signin-google').hidden=true;$('.welcome .or').hidden=true;$('#signin-confirm').hidden=false;signinStatus('Confirm the email address this link was sent to.');
 }
 return new Promise(resolve=>{
  const done=result=>{dialog.onclose=null;resolve(result);};
  $('#signin-google').onclick=safeAction(async()=>{signinStatus('Opening Google\u2026');try{const u=await auth.google();if(u)done({user:u});else signinStatus('Continuing with Google\u2026');}catch(e){signinStatus(e.message,true);}});
  $('#signin-email').onsubmit=safeAction(async e=>{e.preventDefault();const email=$('#signin-email-address').value;if(!isEmail(email)){signinStatus('Enter your email address.',true);return;}await auth.sendEmailLink(email);signinStatus(`Sign-in link sent to ${email.trim()}. Open it on this device to finish.`);$('#signin-email-address').value='';});
  $('#signin-confirm').onsubmit=safeAction(async e=>{e.preventDefault();try{const u=await auth.completeEmailLink($('#signin-confirm-email').value);if(u)done({user:u});}catch(err){signinStatus(err.code==='auth/invalid-action-code'?'This sign-in link has expired or was already used. Request a new one.':err.message,true);}});
  $('#signin-guest').onclick=()=>done({guest:true});
  $('#signin-later').onclick=()=>dialog.close();
  dialog.onclose=()=>{if(cancellable)done({cancelled:true});};
 });
}
// ---- Guest: this device only ----
async function enterGuest(){
 state.guest=true;document.body.classList.add('guest');localStorage.setItem(GUEST_KEY,'1');
 state.band=GUEST_BAND;state.bandDoc=null;state.bands=[];state.members={};state.leftovers=null;state.active=null;state.book='all';state.openSet=null;
 state.scores=await savedScores();state.lists=await savedLists();
 if(state.scores.length){state.active=state.scores[0].id;state.view=hasBlob(active(),'xml')?'score':'original';}
 songbookStatus('Only on this device','guest');renderLibrary();
}
// A guest taps Sign in: the same screen, now closable. On success the guest state is torn down and
// the signed-in boot runs; the device's charts wait in the Library head as an offer, never a merge.
async function signInFromGuest(){
 const choice=await askSignIn(session,{guestDoor:false,cancellable:true});
 if(!choice.user){openPanel('#library-dialog');return;}welcomeStep(null);
 stopPlayback();if(state.set)exitSet();dropPreviews();
 state.guest=false;document.body.classList.remove('guest');localStorage.removeItem(GUEST_KEY);
 state.scores=[];state.lists=[];state.active=null;
 await enterSignedIn(choice.user,{});
 if(state.scores.length)await render();else renderEmpty();
 toast(`Signed in as ${displayName(state.user)}.`);
}
async function findLeftovers(){const [scores,lists]=await Promise.all([savedScores(GUEST_BAND),savedLists(GUEST_BAND)]);state.leftovers=scores.length||lists.length?{scores,lists}:null;renderDeviceCharts();}
async function bringDeviceCharts(){
 const left=state.leftovers;if(!left)return;const {bring,lists}=planBringIn(bandScores(),left.scores,left.lists);
 for(const s of bring){delete s.band;delete s.sync;delete s.missing;state.scores.push(s);await persist(s);}
 for(const l of lists){delete l.band;l.synced=false;state.lists.push(l);await saveList(l);}
 state.leftovers=null;renderLibrary();
 if(!state.active&&state.scores.length){state.active=state.scores[0].id;state.view=hasBlob(active(),'xml')?'score':'original';await render();}
 toast(`Brought ${bring.length} chart${bring.length===1?'':'s'}${lists.length?` and ${lists.length} list${lists.length===1?'':'s'}`:''} into ${state.bandDoc?.name||'the band'}.`);
}
async function forgetDeviceCharts(){
 const left=state.leftovers;if(!left)return;
 for(const s of left.scores)await deleteLocal(s.id);for(const l of left.lists)await deleteListLocal(l.id);
 state.leftovers=null;renderDeviceCharts();toast('Forgot the charts that were on this device.');
}
$('#device-charts-bring').onclick=safeAction(bringDeviceCharts);
$('#device-charts-forget').onclick=safeAction(async()=>{if(!armed($('#device-charts-forget'),'Tap again to delete them from this device'))return;await forgetDeviceCharts();});
// Bands are optional. A person with no band gets a private space of their own, silently; they can
// rename it, invite people into it, or join another band later. Never a screen that demands one.
async function startPersonalSpace(){
 const name='My charts';
 const band=await state.directory.createBand(name,displayName(state.user));
 await refreshBands();return band.id;
}
$('#band-delete').onclick=safeAction(async()=>{
 const band=state.bandDoc;if(!band)return;
 if(!armed($('#band-delete'),`Tap again to delete ${band.name} and its ${state.scores.length} chart${state.scores.length===1?'':'s'}`))return;
 const deleting=state.band,name=band.name;
 state.songbook?.stop();state.stopBand?.();state.songbook=null;state.stopBand=null;
 toast(`Deleting ${name}\u2026`);
 await state.directory.deleteBand(deleting);
 for(const s of state.scores)await deleteLocal(s.id);for(const l of state.lists)await deleteListLocal(l.id);
 state.band=null;state.bandDoc=null;state.scores=[];state.lists=[];state.members={};
 let current=await refreshBands();if(!current)current=await startPersonalSpace();
 await connectBand(current);if(state.scores.length)await render();else renderEmpty();
 toast(`Deleted ${name}.`);
});
function playing(){return state.set?state.lists.find(l=>l.id===state.set.listId&&l.kind==='set')||null:null;}
function setEntry(s=active()){const set=playing();if(!set||!s)return null;const entry=set.items[state.set.index];return entry&&entry.id===s.id?entry:null;}
async function playSet(id,index=0){const set=state.lists.find(l=>l.id===id&&l.kind==='set');if(!set?.items.length)throw Error('Add charts to this setlist first.');state.set={listId:id,index};document.body.classList.add('set-mode');closeDialogs();await goToSetIndex(index,true);}
async function goToSetIndex(index,fromStart=true){const set=playing();if(!set)return;index=Math.max(0,Math.min(set.items.length-1,index));state.set.index=index;const entry=set.items[index],s=state.scores.find(x=>x.id===entry.id);if(!s){renderSetBar();throw Error('That chart is no longer in the band. Remove it from the setlist.');}state.active=s.id;state.page=fromStart?1:9999;state.view=hasBlob(s,'xml')?'score':'original';renderSetBar();renderLibrary();await render();$('#canvas-area').scrollTo(0,0);}
function exitSet(){if(!state.set)return;state.set=null;document.body.classList.remove('set-mode');renderSetBar();if(active())renderControls();renderLibrary();requestAnimationFrame(applyZoom);}
function renderSetBar(){const set=playing();$('#set-bar').hidden=!set;if(!set)return;$('#set-position').textContent=`${set.name} · ${state.set.index+1} / ${set.items.length}`;$('#set-prev').disabled=state.set.index<=0;$('#set-next').disabled=state.set.index>=set.items.length-1;}
async function createList(kind,name){const list=newList(kind,name);state.lists.push(list);if(kind==='book')state.book=list.id;else state.openSet=list.id;await saveList(list);renderLibrary();}
async function savedLists(band=state.band){try{const db=await database();return await new Promise((resolve,reject)=>{const req=db.transaction('lists').objectStore('lists').getAll();req.onsuccess=()=>resolve(req.result.filter(r=>r&&r.band===band&&r.id&&Array.isArray(r.items)));req.onerror=()=>reject(req.error);});}catch{return [];}}
async function persistListLocal(list){try{const db=await database();await new Promise((resolve,reject)=>{const tx=db.transaction('lists','readwrite');tx.objectStore('lists').put({...JSON.parse(JSON.stringify(list)),band:state.band});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}catch{}}
async function deleteListLocal(id){try{const db=await database();await new Promise((resolve,reject)=>{const tx=db.transaction('lists','readwrite');tx.objectStore('lists').delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}catch{}}
async function saveList(list){list.updatedAt=Date.now();await persistListLocal(list);if(!state.songbook)return;try{await state.songbook.saveList(list.id,listPayload(list));list.synced=true;await persistListLocal(list);}catch(e){console.error(e);songbookStatus('Could not save to the band. '+(e.message||''),'error');}}
async function deleteList(list){state.lists.splice(state.lists.indexOf(list),1);await deleteListLocal(list.id);if(state.songbook)state.songbook.removeList(list.id).catch(console.error);if(state.book===list.id)state.book='all';if(state.openSet===list.id)state.openSet=null;if(state.set?.listId===list.id)exitSet();renderLibrary();toast(`Deleted “${list.name}”.`);}
function onListsChange(changes,remoteIds){
 const {removed,changed}=reconcileLists(state.lists,changes);
 for(const id of removed)deleteListLocal(id);
 for(const id of changed){const l=state.lists.find(x=>x.id===id);if(l)persistListLocal(l);}
 if(!state.listsReady){state.listsReady=true;for(const l of [...state.lists]){if(remoteIds.includes(l.id))continue;if(l.synced){state.lists.splice(state.lists.indexOf(l),1);deleteListLocal(l.id);}else saveList(l);}}
 if(state.set){const set=playing();if(!set||!set.items.length)exitSet();else{state.set.index=Math.min(state.set.index,set.items.length-1);renderSetBar();if(changed.includes(set.id))safeAction(render)();}}
 if(state.book!=='all'&&!currentBook())state.book='all';if(state.openSet&&!openSet())state.openSet=null;
 renderLibrary();
}
$('#tab-books').onclick=()=>{state.tab='books';renderLibrary();};$('#tab-sets').onclick=()=>{state.tab='sets';renderLibrary();};$('#tab-catalog').onclick=()=>{state.tab='catalog';renderLibrary();};$('#catalog-search').oninput=e=>{state.catalogQuery=e.target.value;renderCatalog();};
$('#book-new').onsubmit=safeAction(async e=>{e.preventDefault();const name=$('#book-new-name').value.trim();if(!name)return;$('#book-new-name').value='';$('#book-new').hidden=true;await createList('book',name);});
$('#book-new-cancel').onclick=()=>{$('#book-new').hidden=true;};
$('#book-rename').onclick=()=>{const b=currentBook();if(!b)return;$('#book-rename-form').hidden=false;$('#book-rename-name').value=b.name;$('#book-rename-name').focus();};
$('#book-rename-form').onsubmit=safeAction(async e=>{e.preventDefault();const b=currentBook(),name=$('#book-rename-name').value.trim();$('#book-rename-form').hidden=true;if(b&&name&&name!==b.name){b.name=name;await saveList(b);}renderLibrary();});
$('#book-delete').onclick=safeAction(async()=>{const b=currentBook();if(b&&armed($('#book-delete'),'Tap again to delete this binder (charts stay)'))await deleteList(b);});
$('#set-new').onclick=()=>{$('#set-new-form').hidden=false;$('#set-new-name').focus();};$('#set-new-cancel').onclick=()=>{$('#set-new-form').hidden=true;};
$('#set-new-form').onsubmit=safeAction(async e=>{e.preventDefault();const name=$('#set-new-name').value.trim();if(!name)return;$('#set-new-name').value='';$('#set-new-form').hidden=true;await createList('set',name);});
$('#set-back').onclick=()=>{state.openSet=null;renderLibrary();};
$('#set-name').onchange=safeAction(async e=>{const set=openSet(),name=e.target.value.trim();if(!set||!name){e.target.value=set?.name||'';return;}if(name!==set.name){set.name=name;await saveList(set);}renderLibrary();renderSetBar();});
$('#set-play').onclick=safeAction(()=>playSet(state.openSet,state.set?.listId===state.openSet?state.set.index:0));
$('#set-add-button').onclick=safeAction(async()=>{const set=openSet(),id=$('#set-add-select').value;if(!set||!id)return;addItem(set,id);await saveList(set);renderLibrary();});
$('#set-delete').onclick=safeAction(async()=>{const set=openSet();if(set&&armed($('#set-delete'),'Tap again to delete this setlist'))await deleteList(set);});
$('#add-set-button').onclick=safeAction(async()=>{const set=state.lists.find(l=>l.id===$('#add-set-select').value),s=active();if(!set||!s)return;addItem(set,s.id);await saveList(set);renderLibrary();toast(`Added “${scoreTitle(s)}” to “${set.name}”.`);});
$('#set-prev').onclick=safeAction(()=>goToSetIndex(state.set.index-1,true));$('#set-next').onclick=safeAction(()=>goToSetIndex(state.set.index+1,true));$('#set-exit').onclick=exitSet;
// ---- Playback ----
const play={player:null,vrv:null,plan:null,preparedFor:null,highlighted:[]};
function playSettings(){return{melody:$('#play-melody').checked,chords:$('#play-chords').checked,bassOn:$('#play-bass').checked,countIn:$('#play-countin').checked};}
function clearHighlight(){for(const id of play.highlighted)document.getElementById(id)?.classList.remove('playing-note');play.highlighted=[];}
function renderPlayUI(){
 const s=active(),editable=!!s&&hasBlob(s,'xml'),playing=!!play.player?.isPlaying(),paused=!!play.player?.isPaused();
 $('#play-open').disabled=!editable;$('#play-open').classList.toggle('active',playing);$('#play-icon').setAttribute('href',playing?'#i-pause':'#i-play');
 $('#play-toggle').disabled=!editable;$('#play-toggle').textContent=playing?'❚❚ Pause':paused?'▶ Resume':'▶ Play';$('#play-stop').disabled=!playing&&!paused;
 $('#play-caption').textContent=editable?'Piano plays the melody; the chord symbols become comping and bass.':'Import MusicXML or recognize the scan to hear this chart.';
 if(!playing&&!paused)$('#play-status').textContent='';
}
async function preparePlayback(){
 const s=active();if(!s||!hasBlob(s,'xml'))throw Error('Import MusicXML or recognize the scan to hear this chart.');
 if(state.view==='original'){state.view='score';await render();}
 const key=s.id+'|'+JSON.stringify(resolveKey(s,setEntry(s)));
 if(play.preparedFor===key&&play.plan)return play.plan;
 play.vrv=await toolkit();
 const midi=parseMidi(play.vrv.renderToMIDI()),timemap=play.vrv.renderToTimemap({includeMeasures:true});
 const doc=parseScore(currentXML(s)),beats=Number(doc.getElementsByTagName('beats')[0]?.textContent||4),beatType=Number(doc.getElementsByTagName('beat-type')[0]?.textContent||4);
 const notated=id=>{try{return play.vrv.getNotatedIdForElement(id)||id;}catch{return id;}};
 const occurrences=measureOccurrences(timemap,id=>{const a=play.vrv.getElementAttr(id);return a?.n!==undefined?a:play.vrv.getElementAttr(notated(id));},measureNumbers(doc));
 const endMs=Math.max(midi.totalMs,timemap.length?timemap[timemap.length-1].tstamp:0);
 const accompaniment=planAccompaniment(harmonyPositions(doc),occurrences,midi.msPerQuarter,endMs);
 play.plan={notes:midi.notes,accompaniment,totalMs:endMs,msPerQuarter:midi.msPerQuarter,msPerBeat:midi.msPerQuarter*4/beatType,beatsPerBar:beats,baseBpm:midi.bpm,...playSettings()};
 play.preparedFor=key;
 const tempo=s.tempo||midi.bpm;$('#tempo-range').value=tempo;$('#tempo-value').textContent=tempo;$('#tempo-reset').hidden=!s.tempo||s.tempo===midi.bpm;$('#tempo-reset').textContent=`Chart tempo ${midi.bpm}`;
 return play.plan;
}
function ensurePlayer(){
 return play.player??=createPlayer({
  onTick:(ms,countIn)=>{if(countIn){$('#play-status').textContent=`Count-in ${countIn}`;return;}const at=play.vrv.getElementsAtTime(Math.round(ms));const ids=(at?.notes||[]).map(id=>{try{return play.vrv.getNotatedIdForElement(id)||id;}catch{return id;}});if(ids.join()!==play.highlighted.join()){clearHighlight();for(const id of ids)document.getElementById(id)?.classList.add('playing-note');play.highlighted=ids;const page=ids.length?play.vrv.getPageWithElement(ids[0]):at?.page;if(page&&page!==state.page&&state.view!=='original'){state.page=page;updatePages();}}$('#play-status').textContent='Playing';},
  onEnd:finished=>{clearHighlight();renderPlayUI();$('#play-status').textContent=finished?'Finished':'';},
  onStatus:text=>{if(text)$('#play-status').textContent=text;}
 });
}
async function togglePlay(){
 const player=ensurePlayer();
 if(player.isPlaying()){player.pause();renderPlayUI();$('#play-status').textContent='Paused';return;}
 const plan=await preparePlayback();const s=active();
 if(player.isPaused()){await player.start(player.position());renderPlayUI();return;}
 await player.load(plan);player.setRate((s.tempo||plan.baseBpm)/plan.baseBpm);player.update(playSettings());
 await player.start(0);renderPlayUI();
}
function stopPlayback(){if(play.player){play.player.stop();}clearHighlight();renderPlayUI();}
async function openPlay(){closeDialogs();$('#play-dialog').showModal();renderPlayUI();if(active()&&hasBlob(active(),'xml'))await preparePlayback();}
$('#play-open').onclick=safeAction(openPlay);$('#play-toggle').onclick=safeAction(togglePlay);$('#play-stop').onclick=stopPlayback;
$('#tempo-range').oninput=e=>{const s=active();if(!s)return;const bpm=Number(e.target.value);$('#tempo-value').textContent=bpm;s.tempo=bpm;$('#tempo-reset').hidden=!play.plan||bpm===play.plan.baseBpm;if(play.plan)play.player?.setRate(bpm/play.plan.baseBpm);};
$('#tempo-range').onchange=safeAction(async()=>{const s=active();if(s)await persist(s);});
$('#tempo-reset').onclick=safeAction(async()=>{const s=active();if(!s||!play.plan)return;delete s.tempo;$('#tempo-range').value=play.plan.baseBpm;$('#tempo-value').textContent=play.plan.baseBpm;$('#tempo-reset').hidden=true;play.player?.setRate(1);await persist(s);});
for(const id of ['play-melody','play-chords','play-bass','play-countin'])$('#'+id).onchange=()=>{play.player?.update(playSettings());if(play.plan)Object.assign(play.plan,playSettings());};
all('#import-top,#import-side').forEach(b=>b.onclick=()=>$('#file-input').click());
$('#file-input').onchange=safeAction(async e=>{for(const f of e.target.files)await importFile(f);e.target.value='';});
$('#xml-input').onchange=safeAction(async e=>{await importFile(e.target.files[0],true);e.target.value='';});
$('#attach-xml').onclick=()=>$('#xml-input').click();
for(const v of ['original','score','compare'])$('#view-'+v).onclick=safeAction(async()=>{state.view=v;closeDialogs();await render();});
$('#step-down').onclick=safeAction(()=>setTranspose(resolveKey(active(),setEntry()).semitones-1));$('#step-up').onclick=safeAction(()=>setTranspose(resolveKey(active(),setEntry()).semitones+1));$('#reset').onclick=safeAction(resetTranspose);
$('#target-key').onchange=safeAction(async e=>{const s=active(),f=Number(e.target.value);let n=mod((f-s.info.fifths)*7,12);if(n>6)n-=12;await setTranspose(n,f);});
for(const [selector,amount]of [['#zoom-in',10],['#zoom-out',-10]])$(selector).onclick=()=>zoomBy(amount);
$('#fit').onclick=()=>setFit('page');$('#fit-width').onclick=()=>setFit('width');$('#fit-page').onclick=()=>setFit('page');
$('#recognize').onclick=safeAction(recognizeMusic);$('#export-open').onclick=$('#export-menu').onclick=()=>{closeDialogs();openExport();};$('#review-open').onclick=()=>{closeDialogs();openReview();};$('#save-review').onclick=safeAction(saveReview);
$('#library-open').onclick=()=>openPanel('#library-dialog');$('#library-dialog').addEventListener('close',()=>{state.drawerView='library';if(state.scores.some(s=>s.confirmRemove)){for(const s of state.scores)delete s.confirmRemove;}renderLibrary();});
$('#add-to-band').onclick=safeAction(async()=>{const s=active();if(!s?.preview)return;const entry=catalogEntry(s.catalog);closeDialogs();await openCatalog(entry,{add:true});});
$('#empty-library').onclick=()=>{state.tab='books';renderLibrary();openPanel('#library-dialog');};$('#empty-catalog').onclick=()=>{state.tab='catalog';renderLibrary();openPanel('#library-dialog');};$('#empty-import').onclick=()=>$('#file-input').click();
$('#band-open').onclick=$('#band-settings-open').onclick=safeAction(async()=>{if(state.guest){await signInFromGuest();return;}state.drawerView='band';renderDrawerView();});$('#band-back').onclick=()=>{state.drawerView='library';renderDrawerView();};$('#transpose-open').onclick=()=>openPanel('#transpose-dialog');$('#tools-open').onclick=$('#source-open').onclick=()=>openPanel('#tools-dialog');
$('#library-search').oninput=filterLibrary;$('#page-prev').onclick=()=>turnPage(-1);$('#page-next').onclick=()=>turnPage(1);$('#focus-enter').onclick=()=>focusMode(true);$('#focus-exit').onclick=()=>focusMode(false);
all('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
// data-locked is read at event time: the sign-in screen is locked at boot and closable for a guest.
all('dialog').forEach(d=>d.addEventListener('cancel',e=>{if(d.hasAttribute('data-locked'))e.preventDefault();}));
all('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d&&!d.hasAttribute('data-locked')){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
window.addEventListener('resize',()=>requestAnimationFrame(applyZoom));
document.addEventListener('keydown',e=>{if(e.key===' '&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.target.matches('input,textarea,select,button,summary')&&active()&&hasBlob(active(),'xml')){e.preventDefault();safeAction(togglePlay)();return;}if(e.key==='Escape'&&!document.querySelector('dialog[open]'))focusMode(false);if(e.ctrlKey||e.metaKey||e.altKey||document.querySelector('dialog[open]')||e.target.matches('input,textarea,select'))return;const action={'ArrowRight':()=>turnPage(1),'ArrowLeft':()=>turnPage(-1),'+':()=>zoomBy(10),'=':()=>zoomBy(10),'-':()=>zoomBy(-10)}[e.key];if(action){e.preventDefault();action();}});
$('#reviewed').onchange=safeAction(async e=>{active().reviewed=e.target.checked;await persist(active());renderLibrary();renderControls();});
$('#download-original').onclick=()=>download(active().bytes,active().name+'.pdf','application/pdf');
$('#download-xml').onclick=safeAction(()=>{const s=active();if(s.recognized&&!s.reviewed)throw Error('Review the recognized chart first.');download(currentXML(),exportName(s,'musicxml'),'application/vnd.recordare.musicxml+xml');});
async function rasterizeSvg(svg,targetWidth){
 const clone=svg.cloneNode(true);const vb=(clone.getAttribute('viewBox')||'').split(/[\s,]+/).map(Number);
 const w=vb.length===4&&vb[2]?vb[2]:parseFloat(clone.getAttribute('width'))||2100,h=vb.length===4&&vb[3]?vb[3]:parseFloat(clone.getAttribute('height'))||2970;
 const width=targetWidth,height=Math.round(targetWidth*h/w);clone.setAttribute('width',width);clone.setAttribute('height',height);clone.setAttribute('xmlns','http://www.w3.org/2000/svg');clone.setAttribute('xmlns:xlink','http://www.w3.org/1999/xlink');
 for(const el of clone.querySelectorAll('.playing-note'))el.classList.remove('playing-note');
 const blob=new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml;charset=utf-8'}),url=URL.createObjectURL(blob);
 try{
  const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('A page could not be rendered for the PDF.'));img.src=url;});
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,width,height);ctx.drawImage(image,0,0,width,height);
  const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));return{bytes:new Uint8Array(await png.arrayBuffer()),width,height};
 }finally{URL.revokeObjectURL(url);}
}
async function exportPdf(){
 const s=active();if(!s?.xml)throw Error('Recognize the PDF or import MusicXML to export notation.');if(s.recognized&&!s.reviewed)throw Error('Review the recognized chart first.');
 $('#export-dialog').close();if(state.view==='original'){state.view='score';await render();}
 const svgs=all('#notation-pages .paper>svg');if(!svgs.length)throw Error('No notation pages to export.');
 toast(`Building the PDF (${svgs.length} page${svgs.length===1?'':'s'})…`);
 const {PDFDocument}=await import('./vendor/pdf-lib.esm.min.js');const pdf=await PDFDocument.create();pdf.setTitle(scoreTitle(s));pdf.setProducer('ScoreShift');pdf.setCreator('ScoreShift');
 for(const svg of svgs){const {bytes,width,height}=await rasterizeSvg(svg,2550);const image=await pdf.embedPng(bytes);const page=pdf.addPage([612,792]);const scale=Math.min(612/width,792/height);const w=width*scale,h=height*scale;page.drawImage(image,{x:(612-w)/2,y:(792-h)/2,width:w,height:h});}
 download(await pdf.save(),exportName(s,'pdf'),'application/pdf');toast('PDF saved.');
}
$('#download-pdf').onclick=safeAction(exportPdf);
$('#print-score').onclick=safeAction(async()=>{const s=active();if(s.recognized&&!s.reviewed)throw Error('Review the recognized chart first.');$('#export-dialog').close();state.view='score';await render();await document.fonts.ready;window.print();});
let dragDepth=0;document.addEventListener('dragenter',e=>{if(e.dataTransfer?.types.includes('Files')){e.preventDefault();dragDepth++;document.body.classList.add('drop-active');}});document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('dragleave',()=>{if(--dragDepth<=0)document.body.classList.remove('drop-active');});document.addEventListener('drop',safeAction(async e=>{e.preventDefault();dragDepth=0;document.body.classList.remove('drop-active');for(const file of e.dataTransfer.files)await importFile(file);}));
// The signed-in boot: profile, bands, a pending invite, the remembered band, then the band's charts.
async function enterSignedIn(user,{pendingJoin=null}={}){
 state.user=user;localStorage.removeItem(GUEST_KEY);
 const params=new URLSearchParams(location.search);
 // The invite stays in the URL until sign-in completes so an email link can bring it back.
 for(const key of ['join','library'])if(params.has(key)){params.delete(key);}
 history.replaceState(null,'',location.pathname+(params.toString()?'?'+params:'')+location.hash);
 ({fb,db}=await connectFirestore());
 state.directory=createDirectory({fb,db,uid:state.user.uid});
 state.directory.saveProfile({name:displayName(state.user),email:state.user.email,photo:state.user.photoURL}).catch(console.error);
 let current=await refreshBands();
 if(pendingJoin&&!state.bands.some(b=>b.invite===pendingJoin)){try{const band=await state.directory.joinBand(pendingJoin,displayName(state.user));current=band.id;await refreshBands();toast(`Joined ${band.name}.`);}catch(e){console.error(e);toast(e.message);}}
 if(!state.bands.length){try{current=await startPersonalSpace();}catch(e){console.error(e);toast('Could not set up your space. '+(e.message||''));}}
 const remembered=localStorage.getItem(BAND_KEY);if(!pendingJoin&&remembered&&state.bands.some(b=>b.id===remembered))current=remembered;
 try{await connectBand(current);}catch(e){console.error(e);toast(e.message);}
 await findLeftovers();
}
async function init(){
 const params=new URLSearchParams(location.search);
 const pendingJoin=normalizeInvite(params.get('join'));
 renderEmpty();
 // Extra catalog books (published by tools/chart) load before anything can look a chart up.
 try{await loadCatalogBooks();}catch(e){console.warn('Extra catalog books unavailable',e);}
 auth=createAuth({onUser:u=>{state.user=u;}});
 session=await auth.connect();
 const mode=bootMode({user:session.user,pendingLink:session.pendingLink,pendingJoin:!!pendingJoin,rememberedGuest:localStorage.getItem(GUEST_KEY)==='1'});
 let user=session.user;
 if(mode==='signin'){const choice=await askSignIn(session,{guestDoor:!pendingJoin,pendingJoin:!!pendingJoin});user=choice.user||null;}
 welcomeStep(null);
 if(user)await enterSignedIn(user,{pendingJoin});else await enterGuest();
 const requestedScore=params.get('score'),requestedReview=params.get('review');
 if(requestedReview)await openTranscription(requestedReview,true);
 else if(requestedScore&&catalogEntry(requestedScore))await openTranscription(requestedScore);
 else{renderLibrary();if(state.scores.length)await render();else renderEmpty();}
 if(document.modelContext?.registerTool){try{document.modelContext.registerTool({name:'transpose_active_score',title:'Transpose active score',description:'Change notes and chord symbols of the active editable score by semitones. Does not export or modify the original PDF.',inputSchema:{type:'object',properties:{semitones:{type:'integer',minimum:-24,maximum:24}},required:['semitones'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:async input=>{if(!input||Object.keys(input).some(k=>k!=='semitones'))throw Error('Invalid input');await setTranspose(input.semitones);return {title:active().name,semitones:active().semitones,targetKey:$('#target-key').selectedOptions[0].textContent};}});}catch(e){console.warn('WebMCP unavailable',e);}}
}
safeAction(init)();

// Shared songbook: one Firestore library, shared by an invite code.
// Metadata lives in libraries/{code}/scores/{id}; PDF bytes and MusicXML are stored
// beside it in chunked documents at libraries/{code}/scores/{id}/blobs/{field}.{index}.
// Pure helpers are exported for tests; the Firebase SDK is only loaded by connect().
import {firebaseConfig,firebaseSdkVersion} from './firebase-config.mjs';
export const CODE_LENGTH=26,CODE_ALPHABET='abcdefghijkmnpqrstuvwxyz23456789',CHUNK_SIZE=700000;
export const BLOB_FIELDS=['bytes','xml'];
const META_FIELDS=['name','kind','pages','scanned','semitones','targetFifths','reviewed','recognized','warnings','visualDraft','visualFull','userEdited','sampleRevision','info'];
export function newCode(){const values=crypto.getRandomValues(new Uint8Array(CODE_LENGTH));return[...values].map(v=>CODE_ALPHABET[v%CODE_ALPHABET.length]).join('');}
export function normalizeCode(text){
 if(!text)return null;let value=String(text).trim();
 try{if(/^https?:\/\//i.test(value))value=new URL(value).searchParams.get('library')||'';}catch{}
 value=value.toLowerCase().replace(/[^a-z0-9]/g,'');
 return value.length===CODE_LENGTH?value:null;
}
export function inviteLink(code,origin=location.origin){return `${origin}/?library=${code}`;}
export function splitChunks(bytes,size=CHUNK_SIZE){const chunks=[];for(let i=0;i<bytes.length;i+=size)chunks.push(bytes.subarray(i,i+size));return chunks.length?chunks:[new Uint8Array(0)];}
export function joinChunks(chunks){const total=chunks.reduce((n,c)=>n+c.length,0),out=new Uint8Array(total);let offset=0;for(const c of chunks){out.set(c,offset);offset+=c.length;}return out;}
export function encodeField(field,value){return field==='xml'?new TextEncoder().encode(value):new Uint8Array(value);}
export function decodeField(field,bytes){return field==='xml'?new TextDecoder().decode(bytes):bytes;}
export async function digest(data){const bytes=typeof data==='string'?new TextEncoder().encode(data):data;const hash=await crypto.subtle.digest('SHA-256',bytes);return[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');}
export function metadataOf(score){const meta={};for(const key of META_FIELDS)if(score[key]!==undefined)meta[key]=score[key]===null?null:JSON.parse(JSON.stringify(score[key]));return meta;}
export function applyMetadata(score,meta){for(const key of META_FIELDS)if(meta[key]!==undefined)score[key]=meta[key];return score;}
export function hasBlob(score,field){return score[field]!==undefined&&score[field]!==null||!!score.sync?.blobs?.[field];}
async function loadSdk(){
 const base=`https://www.gstatic.com/firebasejs/${firebaseSdkVersion}`;
 const [app,firestore]=await Promise.all([import(`${base}/firebase-app.js`),import(`${base}/firebase-firestore.js`)]);
 return{...app,...firestore};
}
export function createSongbook({code,onChange,onStatus=()=>{},sdk,config=firebaseConfig}){
 if(!normalizeCode(code))throw Error('That invite code is not valid.');
 let fb,db,unsubscribe,firstSnapshot;const queues=new Map();
 const scoresPath=()=>['libraries',code,'scores'];
 const scoreRef=id=>fb.doc(db,...scoresPath(),id);
 const chunkRef=(id,field,index)=>fb.doc(db,...scoresPath(),id,'blobs',`${field}.${index}`);
 function queue(id,task){const previous=queues.get(id)||Promise.resolve();const next=previous.catch(()=>{}).then(task);queues.set(id,next);next.finally(()=>{if(queues.get(id)===next)queues.delete(id);});return next;}
 async function connect(){
  fb=sdk||await loadSdk();
  const app=fb.getApps().find(a=>a.name==='songbook')||fb.initializeApp(config,'songbook');
  db=fb.getFirestore(app);
  onStatus('Connecting…','busy');
  await fb.setDoc(fb.doc(db,'libraries',code),{name:'Songbook',touchedAt:Date.now()},{merge:true});
  return new Promise((resolve,reject)=>{
   firstSnapshot=resolve;
   unsubscribe=fb.onSnapshot(fb.collection(db,...scoresPath()),{includeMetadataChanges:false},snapshot=>{
    const changes=snapshot.docChanges().map(change=>({type:change.type,id:change.doc.id,meta:change.doc.data()}));
    onChange(changes,snapshot.docs.map(d=>d.id));
    onStatus(snapshot.metadata.fromCache?'Offline — changes sync when you reconnect':'Synced','ok');
    if(firstSnapshot){firstSnapshot();firstSnapshot=null;}
   },error=>{console.error(error);onStatus('Could not reach the songbook. '+(error.code==='permission-denied'?'Check the invite code.':'Check your connection.'),'error');if(firstSnapshot){reject(error);firstSnapshot=null;}});
  });
 }
 async function writeBlob(id,field,value,previousCount=0){
  const bytes=encodeField(field,value),chunks=splitChunks(bytes),hash=await digest(bytes);
  for(let i=0;i<chunks.length;i++)await fb.setDoc(chunkRef(id,field,i),{field,index:i,total:chunks.length,data:fb.Bytes.fromUint8Array(chunks[i])});
  for(let i=chunks.length;i<previousCount;i++)await fb.deleteDoc(chunkRef(id,field,i));
  return{hash,count:chunks.length,size:bytes.length};
 }
 async function readBlob(id,field,info){
  const chunks=[];
  for(let i=0;i<info.count;i++){const snap=await fb.getDoc(chunkRef(id,field,i));if(!snap.exists())throw Error('Part of this score is missing from the songbook.');chunks.push(snap.data().data.toUint8Array());}
  const bytes=joinChunks(chunks);
  if(await digest(bytes)!==info.hash)throw Error('This score did not download correctly. Try again.');
  return decodeField(field,bytes);
 }
 // Upload a score's metadata and any blob whose content changed since the last sync.
 function save(score){
  return queue(score.id,async()=>{
   onStatus('Saving…','busy');
   const blobs={...(score.sync?.blobs||{})};
   for(const field of BLOB_FIELDS){
    if(score[field]===undefined||score[field]===null){if(blobs[field]){for(let i=0;i<blobs[field].count;i++)await fb.deleteDoc(chunkRef(score.id,field,i));delete blobs[field];}continue;}
    const hash=await digest(encodeField(field,score[field]));
    if(blobs[field]?.hash!==hash)blobs[field]=await writeBlob(score.id,field,score[field],blobs[field]?.count||0);
   }
   const updatedAt=Date.now();
   await fb.setDoc(scoreRef(score.id),{...metadataOf(score),blobs,updatedAt,savedAt:fb.serverTimestamp()});
   score.sync={blobs,updatedAt};
   onStatus('Synced','ok');
   return score.sync;
  });
 }
 // Download the blobs a score is missing (after a remote change or a fresh join).
 function fetchBlobs(score){
  return queue(score.id,async()=>{
   const missing=score.missing||[];if(!missing.length)return;
   onStatus('Downloading…','busy');
   for(const field of missing){const info=score.sync?.blobs?.[field];if(!info)continue;score[field]=await readBlob(score.id,field,info);}
   delete score.missing;delete score.pdf;
   onStatus('Synced','ok');
  });
 }
 function remove(id){
  return queue(id,async()=>{
   const snap=await fb.getDoc(scoreRef(id));
   if(snap.exists()){const blobs=snap.data().blobs||{};for(const field of Object.keys(blobs))for(let i=0;i<blobs[field].count;i++)await fb.deleteDoc(chunkRef(id,field,i));}
   await fb.deleteDoc(scoreRef(id));
  });
 }
 function stop(){unsubscribe?.();unsubscribe=null;}
 return{code,connect,save,fetchBlobs,remove,stop,link:origin=>inviteLink(code,origin)};
}
// Reconcile a remote change list into the local score list. Returns the ids whose blobs must be fetched
// and the ids that were removed. Pure so it can be unit-tested without Firestore.
export function reconcile(scores,changes){
 const fetch=[],removed=[],added=[],updated=[];
 for(const change of changes){
  const local=scores.find(s=>s.id===change.id);
  if(change.type==='removed'){if(local){scores.splice(scores.indexOf(local),1);removed.push(change.id);}continue;}
  const meta=change.meta,blobs=meta.blobs||{},remoteSync={blobs,updatedAt:meta.updatedAt||0};
  if(!local){const stub=applyMetadata({id:change.id},meta);stub.sync=remoteSync;stub.missing=Object.keys(blobs);scores.push(stub);added.push(change.id);if(stub.missing.length)fetch.push(change.id);continue;}
  if(local.dirty)continue;
  const localSync=local.sync||{blobs:{},updatedAt:0};
  const changed=BLOB_FIELDS.filter(field=>(blobs[field]?.hash||null)!==(localSync.blobs?.[field]?.hash||null));
  if(!changed.length&&remoteSync.updatedAt<=localSync.updatedAt)continue;
  applyMetadata(local,meta);local.sync=remoteSync;updated.push(change.id);
  const missing=changed.filter(field=>blobs[field]);
  for(const field of changed)if(!blobs[field]){delete local[field];}
  if(missing.length){local.missing=[...new Set([...(local.missing||[]),...missing])];delete local.pdf;fetch.push(change.id);}
 }
 return{fetch,removed,added,updated};
}

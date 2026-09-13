// Bands: a band is the shared space a group of musicians plays from. It owns charts, books and
// sets (bands/{id}/scores, bands/{id}/lists) and has members (bands/{id}/members/{uid}). Anyone
// with the band's invite link can join; membership follows the signed-in person, not a device.
// Firestore layout:
//   users/{uid}                      the person: name, the bands they belong to, the band they last opened
//   bands/{id}                       name, owner, invite (current invite code)
//   bands/{id}/members/{uid}         name, role, joinedAt, invite used
//   invites/{code}                   band id behind an invite code; the code is the secret
// Pure helpers are exported for tests; Firestore work happens in createDirectory().
import {newCode,normalizeCode,CODE_LENGTH} from './songbook.mjs';
import {catalog,referenceScore,referenceId} from './catalog.mjs';
export function normalizeInvite(text){
 if(!text)return null;let value=String(text).trim();
 try{if(/^https?:\/\//i.test(value))value=new URL(value).searchParams.get('join')||'';}catch{}
 value=value.toLowerCase().replace(/[^a-z0-9]/g,'');
 return value.length===CODE_LENGTH?value:null;
}
export function inviteLink(code,origin=location.origin){return `${origin}/?join=${code}`;}
export function newBandId(){return crypto.randomUUID();}
export function validBandName(name){const value=String(name||'').trim().replace(/\s+/g,' ');if(value.length<1||value.length>60)throw Error('Give the band a name of 1 to 60 characters.');return value;}
export function memberList(members){
 return Object.entries(members||{}).map(([uid,m])=>({uid,name:m.name||'Musician',role:m.role||'member',joinedAt:m.joinedAt||0}))
  .sort((a,b)=>(a.role==='owner'?0:1)-(b.role==='owner'?0:1)||a.joinedAt-b.joinedAt||a.name.localeCompare(b.name));
}
// Turn a score from the old invite-code library into what the band should hold: a catalog
// chart that was pushed in as a copy becomes a reference (no blobs), unless the band edited
// it; anything else is copied as-is.
export function migrateScore(meta,entries=catalog()){
 const byRef=new Map(entries.map(e=>[referenceId(e),e]));
 const entry=byRef.get(meta.id);
 if(entry&&!meta.userEdited){
  const ref=referenceScore(entry);
  for(const key of ['semitones','targetFifths','tempo'])if(meta[key]!==undefined&&meta[key]!==null)ref[key]=meta[key];
  return{kind:'reference',score:ref};
 }
 if(entry&&meta.userEdited){const {blobs,savedAt,...rest}=meta;return{kind:'copy',score:{...rest,catalog:entry.id,userEdited:true},blobs:blobs||{}};}
 const {blobs,savedAt,...rest}=meta;return{kind:'copy',score:rest,blobs:blobs||{}};
}
export function createDirectory({fb,db,uid,onError=console.error}){
 if(!fb||!db||!uid)throw Error('Sign in first.');
 const userRef=()=>fb.doc(db,'users',uid);
 const bandRef=id=>fb.doc(db,'bands',id);
 const memberRef=(id,who=uid)=>fb.doc(db,'bands',id,'members',who);
 const inviteRef=code=>fb.doc(db,'invites',code);
 async function profile(){const snap=await fb.getDoc(userRef());return snap.exists()?snap.data():null;}
 async function rememberBand(id,name){await fb.setDoc(userRef(),{bands:{[id]:{name,joinedAt:Date.now()}},currentBand:id,updatedAt:Date.now()},{merge:true});}
 async function forgetBand(id){await fb.setDoc(userRef(),{bands:{[id]:fb.deleteField()},updatedAt:Date.now()},{merge:true});}
 async function saveProfile({name,email,photo}){await fb.setDoc(userRef(),{name:name||'',email:email||'',photo:photo||'',updatedAt:Date.now()},{merge:true});}
 async function setCurrent(id){await fb.setDoc(userRef(),{currentBand:id,updatedAt:Date.now()},{merge:true});}
 // Bands the person belongs to, verified against the membership documents so a stale entry
 // (removed by the owner) drops out instead of failing later. The profile is a cache: bands the
 // person OWNS are always recovered by query, so a bad or missing profile can never make the
 // app believe they have no band (which is what would trigger creating another one).
 async function ownedBands(){
  const snap=await fb.getDocs(fb.query(fb.collection(db,'bands'),fb.where('owner','==',uid)));
  return snap.docs.map(d=>({id:d.id,...d.data()}));
 }
 async function myBands(){
  const p=await profile();const out=[];const stale=[];
  for(const [id,info] of Object.entries(p?.bands||{})){
   try{const snap=await fb.getDoc(bandRef(id));if(snap.exists())out.push({id,...snap.data()});else stale.push(id);}
   catch(e){if(e.code==='permission-denied')stale.push(id);else throw e;}
  }
  let repaired=0;
  try{for(const b of await ownedBands())if(!out.some(x=>x.id===b.id)){out.push(b);repaired++;await rememberBand(b.id,b.name).catch(onError);}}
  catch(e){onError(e);}
  if(repaired)console.warn(`Recovered ${repaired} owned band(s) missing from the profile.`);
  for(const id of stale)await forgetBand(id).catch(onError);
  return{bands:out.sort((a,b)=>a.name.localeCompare(b.name)),currentBand:p?.currentBand&&out.some(b=>b.id===p.currentBand)?p.currentBand:out[0]?.id||null,repaired};
 }
 // Owner only. Removes the charts (with their blobs), lists, invite, other members, the band, and
 // finally the owner's own membership, in an order the rules allow at every step.
 async function deleteBand(id,onProgress=()=>{}){
  const band=await fb.getDoc(bandRef(id));if(!band.exists())return;if(band.data().owner!==uid)throw Error('Only the owner can delete a band.');
  const scores=await fb.getDocs(fb.collection(db,'bands',id,'scores'));let done=0;const total=scores.size;
  for(const d of scores.docs){const blobs=d.data().blobs||{};for(const [field,info] of Object.entries(blobs))for(let i=0;i<(info.count||0);i++)await fb.deleteDoc(fb.doc(db,'bands',id,'scores',d.id,'blobs',`${field}.${i}`)).catch(onError);await fb.deleteDoc(d.ref);onProgress(++done,total);}
  const lists=await fb.getDocs(fb.collection(db,'bands',id,'lists'));for(const d of lists.docs)await fb.deleteDoc(d.ref);
  if(band.data().invite)await fb.deleteDoc(inviteRef(band.data().invite)).catch(onError);
  const members=await fb.getDocs(fb.collection(db,'bands',id,'members'));for(const d of members.docs)if(d.id!==uid)await fb.deleteDoc(d.ref);
  await fb.deleteDoc(bandRef(id));
  await fb.deleteDoc(memberRef(id));
  await forgetBand(id);
 }
 async function createBand(name,person){
  name=validBandName(name);const id=newBandId(),code=newCode(),now=Date.now();
  await fb.setDoc(bandRef(id),{name,owner:uid,invite:code,createdAt:now,updatedAt:now});
  await fb.setDoc(memberRef(id),{name:person||'Musician',role:'owner',joinedAt:now});
  await fb.setDoc(inviteRef(code),{band:id,createdBy:uid,createdAt:now});
  await rememberBand(id,name);
  return{id,name,owner:uid,invite:code};
 }
 async function joinBand(text,person){
  const code=normalizeInvite(text);if(!code)throw Error('That invite link is not valid. Paste the whole link.');
  let invite;try{invite=await fb.getDoc(inviteRef(code));}catch(e){if(e.code==='permission-denied')throw Error('Sign in to join a band.');throw e;}
  if(!invite.exists())throw Error('That invite link is no longer valid. Ask for a new one.');
  const id=invite.data().band;
  try{await fb.setDoc(memberRef(id),{name:person||'Musician',role:'member',joinedAt:Date.now(),invite:code});}
  catch(e){if(e.code==='permission-denied')throw Error('That invite could not be used. Ask for a fresh link.');throw e;}
  const band=await fb.getDoc(bandRef(id));const name=band.exists()?band.data().name:'Band';
  await rememberBand(id,name);
  return{id,name,...(band.exists()?band.data():{})};
 }
 async function leaveBand(id){await fb.deleteDoc(memberRef(id));await forgetBand(id);}
 async function removeMember(id,who){if(who===uid)throw Error('Use Leave band to remove yourself.');await fb.deleteDoc(memberRef(id,who));}
 async function renameBand(id,name){name=validBandName(name);await fb.setDoc(bandRef(id),{name,updatedAt:Date.now()},{merge:true});await fb.setDoc(userRef(),{bands:{[id]:{name}}},{merge:true});return name;}
 async function renameSelf(id,name){await fb.setDoc(memberRef(id),{name:String(name||'').trim().slice(0,60)||'Musician'},{merge:true});}
 async function rotateInvite(id){
  const band=await fb.getDoc(bandRef(id));const old=band.data()?.invite,code=newCode(),now=Date.now();
  await fb.setDoc(inviteRef(code),{band:id,createdBy:uid,createdAt:now});
  await fb.setDoc(bandRef(id),{invite:code,updatedAt:now},{merge:true});
  if(old)await fb.deleteDoc(inviteRef(old)).catch(onError);
  return code;
 }
 function watchBand(id,{onBand,onMembers}){
  const stops=[
   fb.onSnapshot(bandRef(id),snap=>onBand(snap.exists()?{id,...snap.data()}:null),onError),
   fb.onSnapshot(fb.collection(db,'bands',id,'members'),snap=>{const members={};for(const d of snap.docs)members[d.id]=d.data();onMembers(members);},onError)
  ];
  return()=>stops.forEach(stop=>stop());
 }
 return{profile,saveProfile,setCurrent,myBands,ownedBands,createBand,deleteBand,joinBand,leaveBand,removeMember,renameBand,renameSelf,rotateInvite,watchBand};
}

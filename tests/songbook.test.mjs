import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newCode,normalizeCode,inviteLink,splitChunks,joinChunks,encodeField,decodeField,digest,metadataOf,applyMetadata,reconcile,CODE_LENGTH,CHUNK_SIZE} from '../dist/songbook.mjs';

test('invite codes are 26 lowercase characters and survive links, dashes, and case',()=>{
 const code=newCode();
 assert.equal(code.length,CODE_LENGTH);assert.match(code,/^[a-z0-9]{26}$/);
 assert.equal(normalizeCode(code.toUpperCase()),code);
 assert.equal(normalizeCode(code.replace(/(.{4})/g,'$1-')),code);
 assert.equal(normalizeCode(inviteLink(code,'https://scoreshift-reader.web.app')),code);
 assert.equal(normalizeCode('too short'),null);assert.equal(normalizeCode(''),null);assert.equal(normalizeCode(null),null);
 assert.notEqual(newCode(),code);
});

test('blobs split into chunks below the Firestore document limit and join back losslessly',async()=>{
 const bytes=new Uint8Array(CHUNK_SIZE*2+123);for(let i=0;i<bytes.length;i++)bytes[i]=i*7%251;
 const chunks=splitChunks(bytes);
 assert.equal(chunks.length,3);assert.ok(chunks.every(c=>c.length<=CHUNK_SIZE));
 assert.deepEqual(joinChunks(chunks),bytes);
 assert.equal(splitChunks(new Uint8Array(0)).length,1);
 const xml='<score-partwise><part id="P1">Ünïcode ♭♯</part></score-partwise>';
 assert.equal(decodeField('xml',joinChunks(splitChunks(encodeField('xml',xml),16))),xml);
 assert.equal(await digest(bytes),await digest(joinChunks(chunks)));
 assert.notEqual(await digest('a'),await digest('b'));
});

test('metadata carries the syncable fields only, never blobs or runtime objects',()=>{
 const score={id:'x',name:'Golden Lady',kind:'xml',pages:2,semitones:-2,targetFifths:-5,reviewed:true,info:{fifths:-3,minor:false,measures:51},bytes:new Uint8Array(3),xml:'<x/>',pdf:{},job:{},sync:{},missing:[]};
 const meta=metadataOf(score);
 assert.deepEqual(Object.keys(meta).sort(),['info','kind','name','pages','reviewed','semitones','targetFifths']);
 assert.notEqual(meta.info,score.info);
 const target=applyMetadata({id:'x'},{...meta,name:'Renamed'});
 assert.equal(target.name,'Renamed');assert.equal(target.semitones,-2);
});

test('reconcile adds remote scores as stubs that need their blobs, applies newer remote edits, and drops removed scores',()=>{
 const blobs={bytes:{hash:'h1',count:1,size:10},xml:{hash:'x1',count:1,size:5}};
 const scores=[{id:'local-only',name:'Mine'},{id:'shared',name:'Old name',semitones:0,sync:{blobs,updatedAt:100},bytes:new Uint8Array(1),xml:'<a/>'}];
 let result=reconcile(scores,[{type:'added',id:'new',meta:{name:'New',blobs,updatedAt:50}}]);
 assert.deepEqual(result,{fetch:['new'],removed:[],added:['new'],updated:[]});
 const stub=scores.find(s=>s.id==='new');assert.deepEqual(stub.missing,['bytes','xml']);assert.equal(stub.name,'New');
 result=reconcile(scores,[{type:'modified',id:'shared',meta:{name:'Old name',semitones:3,blobs,updatedAt:200}}]);
 assert.deepEqual(result.fetch,[]);assert.deepEqual(result.updated,['shared']);assert.equal(scores.find(s=>s.id==='shared').semitones,3);
 result=reconcile(scores,[{type:'modified',id:'shared',meta:{name:'Corrected',blobs:{...blobs,xml:{hash:'x2',count:1,size:6}},updatedAt:300}}]);
 assert.deepEqual(result.fetch,['shared']);const shared=scores.find(s=>s.id==='shared');assert.deepEqual(shared.missing,['xml']);assert.equal(shared.name,'Corrected');assert.equal(shared.bytes.length,1);
 result=reconcile(scores,[{type:'modified',id:'shared',meta:{name:'Stale',blobs:{...blobs,xml:{hash:'x2',count:1,size:6}},updatedAt:250}}]);
 assert.equal(shared.name,'Corrected');
 shared.dirty=true;reconcile(scores,[{type:'modified',id:'shared',meta:{name:'Overwrite attempt',blobs,updatedAt:999}}]);assert.equal(shared.name,'Corrected');
 result=reconcile(scores,[{type:'removed',id:'shared',meta:{}},{type:'removed',id:'never-here',meta:{}}]);
 assert.deepEqual(result.removed,['shared']);assert.deepEqual(scores.map(s=>s.id),['local-only','new']);
});

test('a catalog reference syncs metadata only and keeps the music it fetched from hosting',async()=>{
 const {syncedBlobFields}=await import('../dist/songbook.mjs');
 assert.deepEqual(syncedBlobFields({id:'visual-x',catalog:'x'}),[]);
 assert.deepEqual(syncedBlobFields({id:'visual-x',catalog:'x',userEdited:true}),['bytes','xml']);
 assert.deepEqual(syncedBlobFields({id:'mine'}),['bytes','xml']);
 const scores=[{id:'visual-x',name:'X',catalog:'x',xml:'<score/>',bytes:new Uint8Array(2),sync:{blobs:{},updatedAt:1}}];
 const result=reconcile(scores,[{type:'modified',id:'visual-x',meta:{name:'X',catalog:'x',semitones:2,blobs:{},updatedAt:9}}]);
 assert.deepEqual(result,{fetch:[],removed:[],added:[],updated:['visual-x']});
 assert.equal(scores[0].xml,'<score/>');assert.equal(scores[0].bytes.length,2);assert.equal(scores[0].semitones,2);
 assert.equal(metadataOf({id:'v',name:'V',catalog:'x',book:'real-book',composer:'C'}).catalog,'x');
});

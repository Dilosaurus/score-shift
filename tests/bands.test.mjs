import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeInvite,inviteLink,memberList,migrateScore,validBandName,newBandId} from '../dist/bands.mjs';
import {newCode} from '../dist/songbook.mjs';

test('invite links carry a 26-character code and normalize from links, dashes and case',()=>{
 const code=newCode();
 assert.equal(normalizeInvite(inviteLink(code,'https://scoreshift-reader.web.app')),code);
 assert.equal(normalizeInvite(code.toUpperCase()),code);
 assert.equal(normalizeInvite(code.replace(/(.{4})/g,'$1-')),code);
 assert.equal(normalizeInvite('https://scoreshift-reader.web.app/?library='+code),null,'old library links are not band invites');
 assert.equal(normalizeInvite(''),null);assert.equal(normalizeInvite(null),null);assert.equal(normalizeInvite('short'),null);
 assert.match(newBandId(),/^[0-9a-f-]{36}$/);
});

test('band names are trimmed and bounded',()=>{
 assert.equal(validBandName('  The Tuesday   Trio '),'The Tuesday Trio');
 assert.throws(()=>validBandName(''));assert.throws(()=>validBandName('x'.repeat(61)));
});

test('members list the owner first, then by join order',()=>{
 const members={u3:{name:'Zed',role:'member',joinedAt:30},u1:{name:'Ann',role:'member',joinedAt:10},u2:{name:'Dad',role:'owner',joinedAt:20},u4:{}};
 assert.deepEqual(memberList(members).map(m=>[m.uid,m.name,m.role]),[['u2','Dad','owner'],['u4','Musician','member'],['u1','Ann','member'],['u3','Zed','member']]);
 assert.deepEqual(memberList(undefined),[]);
});

test('migration turns pushed-in catalog copies into references, keeps band edits as copies, and copies imports',()=>{
 const entries=[{id:'avalon',title:'Avalon',book:'colorado-cookbook',pages:1,assetBase:'/samples/colorado-cookbook/colorado-cookbook-avalon'},{id:'golden-lady',title:'Golden Lady',book:'golden-lady',pages:2,visualFull:true,composer:'Stevie Wonder'}];
 const pushed={id:'visual-avalon',name:'Avalon',kind:'xml',semitones:-2,targetFifths:-3,sampleRevision:2,reviewed:true,blobs:{xml:{hash:'x',count:1,size:9},bytes:{hash:'b',count:1,size:9}},updatedAt:5,savedAt:{seconds:1}};
 const ref=migrateScore(pushed,entries);
 assert.equal(ref.kind,'reference');
 assert.deepEqual(ref.score,{id:'visual-avalon',name:'Avalon',kind:'xml',catalog:'avalon',book:'colorado-cookbook',pages:1,semitones:-2,targetFifths:-3,reviewed:true});
 assert.equal(ref.blobs,undefined,'a reference carries no blobs');
 const golden=migrateScore({id:'golden-lady-full-v1',name:'Golden Lady · Full transcription',visualFull:true,blobs:{xml:{hash:'x',count:1,size:1}}},entries);
 assert.equal(golden.kind,'reference');assert.equal(golden.score.catalog,'golden-lady');assert.equal(golden.score.visualFull,true);assert.equal(golden.score.composer,'Stevie Wonder');
 const edited=migrateScore({...pushed,userEdited:true},entries);
 assert.equal(edited.kind,'copy');assert.equal(edited.score.catalog,'avalon');assert.equal(edited.score.userEdited,true);assert.deepEqual(Object.keys(edited.blobs),['xml','bytes']);assert.equal(edited.score.blobs,undefined);assert.equal(edited.score.savedAt,undefined);
 const imported=migrateScore({id:'my-chart',name:'Wedding tune',kind:'pdf',pages:3,blobs:{bytes:{hash:'p',count:2,size:900000}},savedAt:{}},entries);
 assert.equal(imported.kind,'copy');assert.equal(imported.score.catalog,undefined);assert.deepEqual(imported.blobs,{bytes:{hash:'p',count:2,size:900000}});assert.equal(imported.score.name,'Wedding tune');
});

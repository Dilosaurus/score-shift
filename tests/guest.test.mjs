import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bootMode,planBringIn,leftoverSentence,GUEST_BAND,GUEST_KEY} from '../dist/guest.mjs';

test('a signed-in person always goes straight in',()=>{
 assert.equal(bootMode({user:{uid:'u'}}),'signed-in');
 assert.equal(bootMode({user:{uid:'u'},rememberedGuest:true,pendingJoin:true}),'signed-in');
});

test('a remembered guest skips the sign-in screen unless a link or invite brought them here',()=>{
 assert.equal(bootMode({rememberedGuest:true}),'guest');
 assert.equal(bootMode({rememberedGuest:true,pendingLink:true}),'signin','an email sign-in link must finish signing in');
 assert.equal(bootMode({rememberedGuest:true,pendingJoin:true}),'signin','a band invite needs an account');
});

test('a first visit sees the sign-in screen, which carries the guest door',()=>{
 assert.equal(bootMode({}),'signin');assert.equal(bootMode(),'signin');
 assert.equal(GUEST_BAND,'device');assert.equal(GUEST_KEY,'scoreshift-guest');
});

test('bringing device charts in skips what the band already holds and never carries previews',()=>{
 const band=[{id:'visual-avalon'},{id:'own-1'}];
 const device=[{id:'visual-avalon',semitones:2},{id:'imported-1',name:'Dad scan'},{id:'visual-x',preview:true},{id:'review-y',reviewPreview:true},{id:null}];
 const lists=[{id:'l1',kind:'set',items:[{id:'visual-avalon'},{id:'imported-1'}]},{id:'bad'},null];
 const plan=planBringIn(band,device,lists);
 assert.deepEqual(plan.bring.map(s=>s.id),['imported-1']);
 assert.deepEqual(plan.skipped.map(s=>s.id),['visual-avalon']);
 assert.deepEqual(plan.lists.map(l=>l.id),['l1'],'a list still resolves the skipped chart because the ids match');
 assert.deepEqual(planBringIn([],[],undefined),{bring:[],skipped:[],lists:[]});
});

test('the offer sentence counts what is waiting',()=>{
 assert.equal(leftoverSentence([],[]),'');
 assert.equal(leftoverSentence([{id:'a'}],[]),'1 chart from before you signed in is still on this device.');
 assert.equal(leftoverSentence([{id:'a'},{id:'b'}],[{id:'l'}]),'2 charts and 1 binder or setlist from before you signed in are still on this device.');
 assert.equal(leftoverSentence([],[{id:'l'},{id:'m'}]),'2 binders or setlists from before you signed in are still on this device.');
});

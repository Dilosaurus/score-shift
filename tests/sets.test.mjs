import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newList,listPayload,hasItem,addItem,removeItemAt,removeScoreFromList,moveItem,stripFromLists,resolveKey,entryKeyForStep,reconcileLists} from '../dist/sets.mjs';

test('books hold each chart once; sets allow repeats and keep order',()=>{
 const book=newList('book','Standards'),set=newList('set','Sunday brunch');
 assert.equal(book.kind,'book');assert.equal(set.name,'Sunday brunch');assert.throws(()=>newList('folder','x'));
 assert.equal(addItem(book,'a'),true);assert.equal(addItem(book,'a'),false);assert.equal(book.items.length,1);
 addItem(set,'a');addItem(set,'b');addItem(set,'a');assert.deepEqual(set.items.map(i=>i.id),['a','b','a']);
 assert.equal(moveItem(set,2,0),true);assert.deepEqual(set.items.map(i=>i.id),['a','a','b']);
 assert.equal(moveItem(set,0,5),false);assert.equal(moveItem(set,1,1),false);
 assert.equal(removeItemAt(set,1),true);assert.deepEqual(set.items.map(i=>i.id),['a','b']);
 assert.equal(hasItem(set,'b'),true);assert.equal(removeScoreFromList(set,'zzz'),false);
});

test('deleting a chart strips it from every list and reports which lists changed',()=>{
 const book=newList('book','B'),set=newList('set','S'),other=newList('set','O');
 addItem(book,'x');addItem(set,'x');addItem(set,'y');addItem(other,'y');
 const changed=stripFromLists([book,set,other],'x');
 assert.deepEqual(changed.map(l=>l.name),['B','S']);assert.deepEqual(set.items.map(i=>i.id),['y']);assert.equal(book.items.length,0);
});

test('a set entry key overrides the chart key and maps to the right semitone shift',()=>{
 const chart={info:{fifths:-3,minor:false},targetFifths:-1,semitones:2};
 assert.deepEqual(resolveKey(chart,undefined),{fifths:-1,semitones:2,fromSet:false});
 assert.deepEqual(resolveKey(chart,{id:'c'}),{fifths:-1,semitones:2,fromSet:false});
 assert.deepEqual(resolveKey(chart,{id:'c',fifths:0}),{fifths:0,semitones:-3,fromSet:true});
 assert.deepEqual(resolveKey(chart,{id:'c',fifths:4}),{fifths:4,semitones:1,fromSet:true});
 assert.deepEqual(resolveKey(chart,{id:'c',fifths:-3}),{fifths:-3,semitones:0,fromSet:true});
 assert.equal(entryKeyForStep(chart,2),-1);assert.equal(entryKeyForStep(chart,2,11),11);
});

test('payload carries only the fields the rules expect and drops empty keys',()=>{
 const set=newList('set','S');addItem(set,'a');set.items[0].fifths=2;addItem(set,'b');set.synced=true;set.savedAt={seconds:1};
 const p=listPayload(set);
 assert.deepEqual(Object.keys(p).sort(),['createdAt','items','kind','name','updatedAt']);
 assert.deepEqual(p.items,[{id:'a',fifths:2},{id:'b'}]);
});

test('remote list changes replace local copies unless the local copy is a newer unsynced edit',()=>{
 const lists=[{id:'l1',kind:'set',name:'Local newer',items:[],updatedAt:200,synced:false},{id:'l2',kind:'book',name:'Old',items:[],updatedAt:100,synced:true}];
 const r=reconcileLists(lists,[
  {type:'modified',id:'l1',meta:{kind:'set',name:'Remote older',items:[],updatedAt:150}},
  {type:'modified',id:'l2',meta:{kind:'book',name:'Renamed remotely',items:[{id:'a'}],updatedAt:300}},
  {type:'added',id:'l3',meta:{kind:'set',name:'New',items:[],updatedAt:5}},
  {type:'removed',id:'l2',meta:{}},
 ]);
 assert.deepEqual(r.changed,['l2','l3']);assert.deepEqual(r.removed,['l2']);
 assert.equal(lists.find(l=>l.id==='l1').name,'Local newer');
 assert.deepEqual(lists.map(l=>l.id),['l1','l3']);assert.equal(lists[1].synced,true);
 const again=reconcileLists(lists,[{type:'modified',id:'l3',meta:{kind:'set',name:'New',items:[],updatedAt:5}}]);
 assert.deepEqual(again.changed,[]);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BOOKS,GOLDEN_LADY,bookOf,assetUrls,catalog,catalogEntry,referenceId,referenceScore,isReference,searchCatalog,catalogCounts} from '../dist/catalog.mjs';

const sample=[{id:'afro-blue',title:'Afro Blue',page:10,pages:1,revision:2},{id:'colorado-cookbook-avalon',title:'Avalon',page:28,pages:1,revision:1,assetBase:'/samples/colorado-cookbook/colorado-cookbook-avalon'},{id:'bad id!',title:'Nope'}];

test('every published chart belongs to a book and its files come from hosting',()=>{
 assert.equal(bookOf(sample[0]),'real-book');assert.equal(bookOf(sample[1]),'colorado-cookbook');assert.equal(bookOf(GOLDEN_LADY),'golden-lady');
 assert.deepEqual(assetUrls(sample[0]),{xml:'/samples/real-book/afro-blue.mxl',pdf:'/samples/real-book/afro-blue.pdf'});
 assert.deepEqual(assetUrls(sample[1]),{xml:'/samples/colorado-cookbook/colorado-cookbook-avalon.mxl',pdf:'/samples/colorado-cookbook/colorado-cookbook-avalon.pdf'});
 assert.deepEqual(assetUrls(GOLDEN_LADY),{xml:'/samples/golden-lady-full.musicxml',pdf:'/samples/golden-lady.pdf'});
 assert.throws(()=>assetUrls({id:'x',assetBase:'/samples/../secret'}));
 assert.ok(BOOKS.every(b=>b.id&&b.title));
});

test('the catalog lists Golden Lady plus every valid transcription, searchable by title and book',()=>{
 const entries=catalog(sample);
 assert.deepEqual(entries.map(e=>e.id),['golden-lady','afro-blue','colorado-cookbook-avalon'],'invalid ids are dropped');
 assert.equal(catalogEntry('afro-blue',sample).title,'Afro Blue');assert.equal(catalogEntry('missing',sample),null);
 assert.deepEqual(searchCatalog(entries,'av').map(e=>e.id),['colorado-cookbook-avalon']);
 assert.deepEqual(searchCatalog(entries,'',"real-book").map(e=>e.id),['afro-blue']);
 assert.deepEqual(searchCatalog(entries).map(e=>e.title),['Afro Blue','Avalon','Golden Lady']);
 assert.deepEqual(catalogCounts(entries),{'golden-lady':1,'real-book':1,'colorado-cookbook':1});
});

test('references keep the pre-band score ids so old books and sets still resolve',()=>{
 const entries=catalog(sample);
 assert.equal(referenceId(entries[0]),'golden-lady-full-v1');assert.equal(referenceId(entries[1]),'visual-afro-blue');
 const ref=referenceScore(entries[2]);
 assert.deepEqual(ref,{id:'visual-colorado-cookbook-avalon',name:'Avalon',kind:'xml',catalog:'colorado-cookbook-avalon',book:'colorado-cookbook',pages:1,semitones:0,reviewed:true});
 assert.equal(ref.xml,undefined);assert.equal(ref.bytes,undefined);
 const golden=referenceScore(entries[0]);assert.equal(golden.visualFull,true);assert.equal(golden.composer,'Stevie Wonder');assert.equal(golden.pages,2);
 assert.equal(isReference(ref),true);assert.equal(isReference({...ref,userEdited:true}),false);assert.equal(isReference({id:'mine'}),false);
});

import {extra,mergeCatalogBooks,loadCatalogBooks} from '../dist/catalog.mjs';

test('extra books from /catalog load additively and never touch the shipped transcriptions',async()=>{
 const files={
  '/catalog/books.json':[{id:'dads-charts',title:'Dad’s charts',subtitle:'Transcribed at home'},{id:'bad id',title:'Nope'},{id:'empty-book',title:'Empty'}],
  '/catalog/dads-charts.json':[
   {id:'dads-charts-blue-bossa',title:'Blue Bossa',composer:'Kenny Dorham',pages:1,revision:2},
   {id:'afro-blue',title:'Shadowing a shipped id',pages:1,revision:1},
   {id:'dads-charts-escape',title:'Escape',assetBase:'/samples/real-book/sneaky',pages:1,revision:1},
   {id:'no title'}
  ]
 };
 const seen=[];
 const fetchFn=async(url,opts)=>{seen.push([url,opts?.cache]);const body=files[url];return body?{ok:true,json:async()=>body}:{ok:false,json:async()=>{throw Error('404');}};};
 const before=BOOKS.length,already=catalog().length;
 const added=await loadCatalogBooks(fetchFn);
 assert.deepEqual(added,['dads-charts-blue-bossa'],'shadowed ids, foreign asset bases and invalid entries are dropped');
 assert.equal(BOOKS.length,before+2,'both well-formed books register, even an empty one');
 assert.deepEqual(BOOKS.at(-2),{id:'dads-charts',title:'Dad’s charts',subtitle:'Transcribed at home'});
 assert.equal(catalog().length,already+1);
 const entry=catalogEntry('dads-charts-blue-bossa');
 assert.deepEqual(entry,{id:'dads-charts-blue-bossa',title:'Blue Bossa',composer:'Kenny Dorham',pages:1,revision:2,assetBase:'/samples/dads-charts/dads-charts-blue-bossa',book:'dads-charts'});
 assert.deepEqual(assetUrls(entry),{xml:'/samples/dads-charts/dads-charts-blue-bossa.mxl',pdf:'/samples/dads-charts/dads-charts-blue-bossa.pdf'});
 assert.equal(referenceId(entry),'visual-dads-charts-blue-bossa');
 assert.ok(seen.every(([,cache])=>cache==='no-store'),'catalog files are never served stale');
 assert.deepEqual(await loadCatalogBooks(fetchFn),[],'a second load adds nothing');
 assert.deepEqual(await loadCatalogBooks(async()=>{throw Error('offline');}),[],'no index means no extra books, never an error');
 assert.deepEqual(mergeCatalogBooks(null,{}),[]);
 extra.length=0;BOOKS.length=before;
});

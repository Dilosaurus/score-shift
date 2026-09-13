// The catalog: charts ScoreShift ships, transcribed from the source books and served as static
// files under /samples. A band never receives a copy; it holds a reference (a score document
// with a `catalog` id and no blobs) and the reader fetches the MXL and PDF from hosting.
// Editing the notes forks the chart: the band then stores its own MusicXML blob.
import {transcriptions} from './transcriptions.mjs';
export const BOOKS=[
 {id:'real-book',title:'The Real Book',subtitle:'Sixth Edition · Volume 1'},
 {id:'colorado-cookbook',title:'The Colorado Cookbook',subtitle:''},
 {id:'golden-lady',title:'Golden Lady',subtitle:'Complete transcription'}
];
// Additional books arrive additively from hosting: /catalog/books.json lists them and each book's
// /catalog/<id>.json lists its charts, with the music under /samples/<id>/. They are published by
// a different pipeline (tools/chart) than transcriptions.mjs, so neither publisher ever rewrites
// the other's files. Loaded once at boot; a missing index simply means no extra books.
export const extra=[];
const ID=/^[a-z0-9][a-z0-9-]*$/;
export function mergeCatalogBooks(index,entriesByBook,books=BOOKS,list=extra){
 const added=[];
 for(const book of Array.isArray(index)?index:[]){
  if(!book||!ID.test(book.id||'')||typeof book.title!=='string')continue;
  if(!books.some(b=>b.id===book.id))books.push({id:book.id,title:book.title,subtitle:book.subtitle||''});
  for(const entry of entriesByBook[book.id]||[]){
   if(!entry||!ID.test(entry.id||'')||typeof entry.title!=='string')continue;
   if(transcriptions.some(e=>e.id===entry.id)||list.some(e=>e.id===entry.id))continue;
   const base=entry.assetBase||`/samples/${book.id}/${entry.id}`;
   if(!base.startsWith(`/samples/${book.id}/`)||base.includes('..'))continue;
   const item={id:entry.id,title:entry.title,pages:Number.isInteger(entry.pages)&&entry.pages>0?entry.pages:1,revision:Number.isInteger(entry.revision)?entry.revision:1,assetBase:base,book:book.id};
   if(entry.composer)item.composer=String(entry.composer);
   if(entry.page)item.page=entry.page;
   list.push(item);added.push(item.id);
  }
 }
 return added;
}
export async function loadCatalogBooks(fetchFn=globalThis.fetch,base=''){
 let index;
 try{const r=await fetchFn(base+'/catalog/books.json',{cache:'no-store'});if(!r.ok)return [];index=await r.json();}catch{return [];}
 const entriesByBook={};
 for(const book of Array.isArray(index)?index:[]){
  if(!book||!ID.test(book.id||''))continue;
  try{const r=await fetchFn(`${base}/catalog/${book.id}.json`,{cache:'no-store'});entriesByBook[book.id]=r.ok?await r.json():[];}catch{entriesByBook[book.id]=[];}
 }
 return mergeCatalogBooks(index,entriesByBook);
}
export const GOLDEN_LADY={id:'golden-lady',title:'Golden Lady',composer:'Stevie Wonder',book:'golden-lady',pages:2,revision:2,xmlUrl:'/samples/golden-lady-full.musicxml',pdfUrl:'/samples/golden-lady.pdf',visualFull:true};
export function bookOf(entry){
 if(entry.book)return entry.book;
 const base=entry.assetBase||'';const match=base.match(/^\/samples\/([a-z0-9-]+)\//);
 return match&&BOOKS.some(b=>b.id===match[1])?match[1]:'real-book';
}
export function assetUrls(entry){
 if(entry.xmlUrl)return{xml:entry.xmlUrl,pdf:entry.pdfUrl};
 const base=entry.assetBase||'/samples/real-book/'+entry.id;
 if(!/^\/samples\/[a-z0-9/-]+$/.test(base)||base.includes('..'))throw Error('Invalid catalog location.');
 return{xml:base+'.mxl',pdf:base+'.pdf'};
}
export function catalog(list=[...transcriptions,...extra]){return[GOLDEN_LADY,...list.filter(e=>/^[a-z0-9-]+$/.test(e.id)).map(e=>({...e,book:bookOf(e)}))];}
export function catalogEntry(id,list){return catalog(list).find(e=>e.id===id)||null;}
// Score ids for references keep the ids the app used before bands existed, so books and sets
// written back then keep pointing at the same chart after migration.
export function referenceId(entry){return entry.id==='golden-lady'?'golden-lady-full-v1':'visual-'+entry.id;}
export function referenceScore(entry){
 const score={id:referenceId(entry),name:entry.title,kind:'xml',catalog:entry.id,book:entry.book||bookOf(entry),pages:entry.pages||1,semitones:0,reviewed:true};
 if(entry.visualFull)score.visualFull=true;if(entry.composer)score.composer=entry.composer;
 return score;
}
export function isReference(score){return!!score?.catalog&&!score.userEdited;}
export function searchCatalog(entries,query='',book=''){
 const q=String(query||'').toLowerCase().trim();
 return entries.filter(e=>(!book||e.book===book)&&(!q||e.title.toLowerCase().includes(q))).sort((a,b)=>a.title.localeCompare(b.title));
}
export function catalogCounts(entries){const counts={};for(const e of entries)counts[e.book]=(counts[e.book]||0)+1;return counts;}

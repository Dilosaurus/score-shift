// Small gaps in older Safari that pdf.js 6 assumes are filled. Imported first by app.mjs and by the
// worker wrapper (pdf-worker.mjs), so both the page and the PDF worker get them. Each one is a
// no-op where the platform already has the feature.
//
// ReadableStream async iteration (`for await (const chunk of stream)`): pdf.js uses it to gather
// text content and to read native DecompressionStreams. Safari before 26 has no
// ReadableStream.prototype[Symbol.asyncIterator]; the first user bug (2026-09-11, iPhone) was
// "undefined is not a function (near '...value of readableStream...')" on PDF import.
export function installReadableStreamIterator(proto = globalThis.ReadableStream?.prototype) {
 if(!proto||typeof proto[Symbol.asyncIterator]==='function')return false;
 proto.values=proto.values||function values({preventCancel=false}={}){
  const reader=this.getReader();
  return{
   async next(){try{const r=await reader.read();if(r.done)reader.releaseLock();return r;}catch(e){reader.releaseLock();throw e;}},
   async return(value){if(!preventCancel){try{await reader.cancel(value);}catch{}}reader.releaseLock();return{done:true,value};},
   [Symbol.asyncIterator](){return this;}
  };
 };
 proto[Symbol.asyncIterator]=proto.values;
 return true;
}
// Promise.withResolvers (Safari 17.4+): pdf.js 4+ calls it while opening a document.
export function installPromiseWithResolvers(P=globalThis.Promise){
 if(typeof P.withResolvers==='function')return false;
 P.withResolvers=function(){let resolve,reject;const promise=new this((res,rej)=>{resolve=res;reject=rej;});return{promise,resolve,reject};};
 return true;
}
installReadableStreamIterator();
installPromiseWithResolvers();

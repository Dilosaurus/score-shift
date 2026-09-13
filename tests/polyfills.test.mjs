import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installReadableStreamIterator,installPromiseWithResolvers} from '../dist/polyfills.mjs';

function stream(chunks){return new ReadableStream({start(c){for(const x of chunks)c.enqueue(x);c.close();}});}

test('the ReadableStream iterator polyfill is a no-op where the platform has one',()=>{
 assert.equal(installReadableStreamIterator(ReadableStream.prototype),false,'Node already iterates streams');
 assert.equal(installPromiseWithResolvers(Promise),false);
});

test('on a stream class without async iteration, for await works and releases the reader',async()=>{
 class OldStream extends ReadableStream{}
 Object.defineProperty(OldStream.prototype,Symbol.asyncIterator,{value:undefined,writable:true,configurable:true});
 Object.defineProperty(OldStream.prototype,'values',{value:undefined,writable:true,configurable:true});
 assert.equal(typeof OldStream.prototype[Symbol.asyncIterator],'undefined');
 assert.equal(installReadableStreamIterator(OldStream.prototype),true);
 const s=new OldStream({start(c){c.enqueue('a');c.enqueue('b');c.close();}});
 const got=[];for await(const chunk of s)got.push(chunk);
 assert.deepEqual(got,['a','b']);
 assert.equal(s.locked,false,'the reader lock is released after the stream ends');
 const early=new OldStream({start(c){c.enqueue(1);c.enqueue(2);}});
 for await(const chunk of early){assert.equal(chunk,1);break;}
 assert.equal(early.locked,false,'breaking out cancels and releases');
 assert.equal(installReadableStreamIterator(OldStream.prototype),false,'installed once');
 const plain=stream(['x']);const out=[];for await(const c of plain)out.push(c);assert.deepEqual(out,['x']);
});

test('Promise.withResolvers polyfill matches the platform shape',async()=>{
 const P=class extends Promise{};Object.defineProperty(P,'withResolvers',{value:undefined,writable:true,configurable:true});
 assert.equal(installPromiseWithResolvers(P),true);
 const {promise,resolve}=P.withResolvers();resolve(7);assert.equal(await promise,7);
});

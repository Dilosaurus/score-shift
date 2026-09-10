import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {unzipSync,strFromU8} from 'fflate';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {scoreInfo,parseScore,transposeScore} from '../dist/music.mjs';
import createVerovioModule from 'verovio/wasm';
import {VerovioToolkit} from 'verovio/esm';
const url='http://127.0.0.1:5173',input=await fs.readFile('C:/Users/Chris/Downloads/Golden Lady chart.pdf');
const served=new Uint8Array(await(await fetch(url+'/samples/golden-lady.pdf')).arrayBuffer());
const hash=b=>createHash('sha256').update(b).digest('hex');assert.equal(hash(input),hash(served));
const loading=pdfjs.getDocument({data:served.slice(),isEvalSupported:false});const doc=await loading.promise;assert.equal(doc.numPages,2);
for(let i=1;i<=2;i++){const page=await doc.getPage(i),view=page.getViewport({scale:1.3}),canvas=createCanvas(Math.ceil(view.width),Math.ceil(view.height));await page.render({canvasContext:canvas.getContext('2d'),viewport:view}).promise;await fs.writeFile(`tmp/pdfjs-page-${i}.png`,canvas.toBuffer('image/png'));}
await loading.destroy();
assert.equal((await fetch(url+'/api/health')).status,200);
assert.equal((await fetch(url+'/api/recognize',{method:'POST',headers:{Origin:'https://example.com','X-ScoreShift':'recognize'},body:input})).status,403);
assert.equal((await fetch(url+'/api/recognize',{method:'POST',headers:{'X-ScoreShift':'recognize'},body:'not a PDF'})).status,400);
const id=(await fs.readFile('tmp/test-job-id.txt','utf8')).trim(),job=await(await fetch(url+'/api/jobs/'+id)).json();assert.equal(job.status,'done');assert.ok(job.movements>0);
const vrv=new VerovioToolkit(await createVerovioModule()),results=[];
for(let i=0;i<job.movements;i++){const bytes=new Uint8Array(await(await fetch(`${url}/api/jobs/${id}/result?index=${i}`)).arrayBuffer()),archive=unzipSync(bytes),xml=strFromU8(archive[Object.keys(archive).find(k=>k.endsWith('.xml')&&!k.startsWith('META-INF'))]),info=scoreInfo(parseScore(xml,DOMParser)),transposed=transposeScore(xml,2,undefined,DOMParser,XMLSerializer);vrv.setOptions({inputFrom:'xml',pageWidth:2100,pageHeight:2970,scale:42});assert.ok(vrv.loadData(transposed));assert.ok(vrv.getPageCount()>0);await fs.writeFile(`tmp/recognized-${i+1}.svg`,vrv.renderToSVG(1));await fs.writeFile(`tmp/recognized-${i+1}.musicxml`,xml);results.push({...info,pages:vrv.getPageCount()});}
vrv.destroy();
const report={pdfPages:2,exactOriginalHash:hash(input),pdfjsRenderedPages:2,recognitionMovements:job.movements,recognitionWarnings:job.warnings,recognizedScores:results,securityChecks:'untrusted origin and invalid PDF rejected'};await fs.writeFile('tmp/verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));

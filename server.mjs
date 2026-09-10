import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const root=path.resolve('dist'), jobsRoot=path.resolve('.runtime/jobs');
const engine=process.env.AUDIVERIS_PATH||path.resolve('.runtime/engine/Audiveris/Audiveris.exe');
const port=Number(process.env.PORT||5173),jobs=new Map();
const allowedOrigins=new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`,'https://score-shift-chris.wise-mite-5926.chatgpt.site',process.env.SCORESHIFT_ORIGIN].filter(Boolean));
const types={'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.js':'text/javascript','.png':'image/png','.pdf':'application/pdf','.wasm':'application/wasm','.xml':'application/xml','.musicxml':'application/xml'};
function json(res,status,body){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));}
async function walk(folder){const entries=await fsp.readdir(folder,{withFileTypes:true});return(await Promise.all(entries.map(e=>e.isDirectory()?walk(path.join(folder,e.name)):path.join(folder,e.name)))).flat();}
async function recognize(req,res){
 if(!fs.existsSync(engine))return json(res,503,{error:'Music recognition is not installed. Run setup-recognition.ps1 on this computer, or import MusicXML.'});
 if([...jobs.values()].some(j=>j.status==='running'))return json(res,409,{error:'One score is already being recognized. Please wait for it to finish.'});
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>50*1024*1024)return json(res,413,{error:'Choose a PDF smaller than 50 MB.'});chunks.push(chunk);}
 const bytes=Buffer.concat(chunks);if(bytes.subarray(0,5).toString()!=='%PDF-')return json(res,400,{error:'The uploaded file is not a PDF.'});
 const id=randomUUID(),folder=path.join(jobsRoot,id),input=path.join(folder,'score.pdf');await fsp.mkdir(folder,{recursive:true});await fsp.writeFile(input,bytes);
 const job={id,status:'running',stage:'Starting music recognition',started:Date.now(),warnings:0};jobs.set(id,job);
 const child=spawn(engine,['-batch','-export','-output',folder,'--',input],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let log='';const consume=data=>{const text=data.toString();log=(log+text).slice(-200000);job.warnings+=(text.match(/WARN|no correct rhythm|No timeOffset|too long/g)||[]).length;const stages=[...text.matchAll(/StepMonitoring\s+\d+\s+\|\s+(\w+)/g)];if(stages.length)job.stage=stages.at(-1)[1].replaceAll('_',' ').toLowerCase();};child.stdout.on('data',consume);child.stderr.on('data',consume);
 let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;child.kill();},10*60*1000);
 child.on('error',e=>{clearTimeout(timeout);job.status='failed';job.error='The recognition engine could not start: '+e.message;});
 child.on('close',async code=>{clearTimeout(timeout);try{await fsp.writeFile(path.join(folder,'recognition.log'),log);const files=await walk(folder);job.files=files.filter(f=>/\.(mxl|musicxml)$/i.test(f));if(code!==0||!job.files.length||timedOut){job.status='failed';job.error=timedOut?'Recognition took too long. Try a shorter PDF.':'This scan could not be fully recognized. Try a cleaner scan or import a MusicXML score.';}else{job.status='done';job.stage='Ready for review';}}catch{job.status='failed';job.error='Could not read the recognition result.';}});
 json(res,202,{id,status:job.status});
}
http.createServer(async(req,res)=>{
 try{
 const host=req.headers.host;if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host))return json(res,403,{error:'Invalid host'});
 const url=new URL(req.url,`http://127.0.0.1:${port}`),pathname=decodeURIComponent(url.pathname);
 if(pathname.startsWith('/api/')){
 const origin=req.headers.origin;
 if(origin&&!allowedOrigins.has(origin))return json(res,403,{error:'Origin not allowed'});
 if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Private-Network','true');}
 if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,X-ScoreShift'});return res.end();}
 if(pathname==='/api/health'&&req.method==='GET')return json(res,200,{available:fs.existsSync(engine),engine:'Audiveris 5.11.0'});
 if(pathname==='/api/recognize'&&req.method==='POST'){if(req.headers['x-scoreshift']!=='recognize')return json(res,403,{error:'Missing request header'});return await recognize(req,res);}
 const match=pathname.match(/^\/api\/jobs\/([a-f0-9-]+)(\/result)?$/);
 if(match&&req.method==='GET'){const j=jobs.get(match[1]);if(!j)return json(res,404,{error:'Recognition job not found.'});if(match[2]){if(j.status!=='done')return json(res,409,{error:'Recognition is not complete.'});const i=Number(url.searchParams.get('index')||0),file=j.files[i];if(!file)return json(res,404,{error:'Movement not found.'});res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="score-${i+1}.mxl"`});return fs.createReadStream(file).pipe(res);}return json(res,200,{id:j.id,status:j.status,stage:j.stage,warnings:j.warnings,error:j.error,movements:j.files?.length||0});}
 return json(res,404,{error:'Not found'});
 }
 if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Method not allowed'});
 const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep))return json(res,403,{error:'Invalid path'});
 const stat=await fsp.stat(file);if(!stat.isFile())return json(res,404,{error:'Not found'});
 res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});if(req.method==='HEAD')return res.end();fs.createReadStream(file).pipe(res);
 }catch(e){if(!res.headersSent)json(res,e.code==='ENOENT'?404:500,{error:e.code==='ENOENT'?'Not found':'Could not complete the request.'});else res.end();}
}).listen(port,'127.0.0.1',()=>console.log(`ScoreShift ready: http://127.0.0.1:${port}`));


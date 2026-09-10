import fs from 'node:fs';
import assert from 'node:assert/strict';
const html=fs.readFileSync('dist/index.html','utf8');
for(const [,url]of html.matchAll(/(?:src|href)="(\/[^\"]*)"/g)){if(url!=='/')assert.ok(fs.existsSync('dist'+url),url);}
for(const file of ['app','music','chords']){const src=fs.readFileSync(`dist/${file}.mjs`,'utf8');for(const [,url]of src.matchAll(/(?:from |import\()'\.\/([^']+)'/g))assert.ok(fs.existsSync('dist/'+url),url);}
assert.ok(fs.existsSync('dist/vendor/pdf.worker.mjs'));console.log('Static entrypoint, JS imports, PDF worker, and sample assets present.');

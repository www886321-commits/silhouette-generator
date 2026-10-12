// SPDX-License-Identifier: AGPL-3.0-only
import {cp,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),licenses=path.join(root,'licenses');
await mkdir(licenses,{recursive:true});
await cp(path.join(root,'node_modules/@imgly/background-removal/LICENSE.md'),path.join(root,'LICENSE'));
await cp(path.join(root,'node_modules/@imgly/background-removal/ThirdPartyLicenses.json'),path.join(licenses,'IMG-LY-ThirdPartyLicenses.json'));
const packages=[];
const modules=path.join(root,'node_modules');
const folders=[];
for(const entry of await readdir(modules,{withFileTypes:true})){
 if(!entry.isDirectory()||entry.name.startsWith('.'))continue;
 if(entry.name.startsWith('@')){
  for(const child of await readdir(path.join(modules,entry.name),{withFileTypes:true}))if(child.isDirectory())folders.push(path.join(modules,entry.name,child.name));
 }else folders.push(path.join(modules,entry.name));
}
for(const folder of folders){
 let meta;try{meta=JSON.parse(await readFile(path.join(folder,'package.json'),'utf8'));}catch{continue;}
 const target=path.join(licenses,'npm',meta.name.replaceAll('/','__')),files=[];
 for(const entry of await readdir(folder,{withFileTypes:true})){
  if(entry.isFile()&&/^(license|licence|copying|notice)(\.|-|$)/i.test(entry.name)){
   await mkdir(target,{recursive:true});await cp(path.join(folder,entry.name),path.join(target,entry.name));files.push('npm/'+meta.name.replaceAll('/','__')+'/'+entry.name);
  }
 }
 packages.push({name:meta.name,version:meta.version,license:meta.license||meta.licenses||'See upstream',source:'https://www.npmjs.com/package/'+meta.name+'/v/'+meta.version,files});
}
packages.sort((a,b)=>a.name.localeCompare(b.name));
await writeFile(path.join(licenses,'DEPENDENCY-LICENSES.json'),JSON.stringify(packages,null,2));
// Exact preferred source for the unmodified AGPL dependency, supplied in its
// published source map. Preserve the map and all bundled original source text.
const vendor=path.join(root,'vendor','imgly-background-removal-1.7.0');await mkdir(path.join(vendor,'sources'),{recursive:true});
const mapFile=path.join(root,'node_modules/@imgly/background-removal/dist/index.mjs.map');
const map=JSON.parse(await readFile(mapFile,'utf8')),mapping=[];
for(let i=0;i<map.sources.length;i++){
 if(typeof map.sourcesContent[i]!=='string')throw Error('Dependency source map has a missing source.');
 const filename=String(i).padStart(3,'0')+'-'+path.basename(map.sources[i]);
 await writeFile(path.join(vendor,'sources',filename),map.sourcesContent[i]);mapping.push({original:map.sources[i],file:'sources/'+filename});
}
for(const name of ['package.json','LICENSE.md','README.md','CHANGELOG.md','ThirdPartyLicenses.json'])await cp(path.join(root,'node_modules/@imgly/background-removal',name),path.join(vendor,name));
await cp(mapFile,path.join(vendor,'index.mjs.map'));await writeFile(path.join(vendor,'SOURCE-MAP-INDEX.json'),JSON.stringify(mapping,null,2));
await writeFile(path.join(vendor,'SOURCE-NOTICE.md'),'# Exact dependency source\n\nUnmodified @imgly/background-removal 1.7.0. Original preferred source text (including TypeScript) was extracted without editing from the complete sourcesContent in its published index.mjs.map. SOURCE-MAP-INDEX.json maps each preserved file to its original module name. The original map, package metadata, AGPL license and notices are included.\n\nUpstream: https://github.com/imgly/background-removal-js\nPinned npm distribution: https://www.npmjs.com/package/@imgly/background-removal/v/1.7.0\n\nThe application is rebuilt using npm ci and the pinned package-lock.json; this dependency is unmodified, not rebuilt from this snapshot. Other external libraries remain available from their pinned npm source URLs in licenses/DEPENDENCY-LICENSES.json.\n');
for(const [name,url] of [
 ['ONNX-Runtime-MIT.txt','https://raw.githubusercontent.com/microsoft/onnxruntime/main/LICENSE'],
 ['DIS-Apache-2.0.txt','https://raw.githubusercontent.com/xuebinqin/DIS/main/LICENSE.md']
]){
 const target=path.join(licenses,name);
 try{const existing=await readFile(target,'utf8');if(existing.length>1000&&/MIT|Apache License/.test(existing))continue;}catch{}
 let lastError;
 for(let attempt=0;attempt<3;attempt++)try{
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('License fetch failed: '+response.status);
  await writeFile(target,await response.text());lastError=undefined;break;
 }catch(error){lastError=error;}
 if(lastError)throw lastError;
}
console.log('License inventory: '+packages.length+' npm packages; '+mapping.length+' exact dependency source modules.');

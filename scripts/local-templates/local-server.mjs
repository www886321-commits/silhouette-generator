// Copyright 2026 Anyu. SPDX-License-Identifier: AGPL-3.0-only
// Local-only static server: no uploads, startup registration or PowerShell.
import {createReadStream, existsSync} from 'node:fs';
import {access, open, readFile, stat, writeFile, unlink} from 'node:fs/promises';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const filename=fileURLToPath(import.meta.url), here=path.dirname(filename);
const root=path.join(here,existsSync(path.join(here,'app','index.html'))?'app':'dist');
const statePath=path.join(here,'.afterimage-runtime.json'), logPath=path.join(here,'startup.log');
const host='127.0.0.1';
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.wasm':'application/wasm','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8'};
function browser(url){
 if(process.argv.includes('--no-open'))return;
 const command=process.platform==='win32'?'cmd.exe':process.platform==='darwin'?'open':'xdg-open';
 const args=process.platform==='win32'?['/d','/c','start','',url]:[url];
 const child=spawn(command,args,{detached:true,stdio:'ignore',windowsHide:true});
 child.on('error',()=>console.log('Please open: '+url));child.unref();
}
async function health(){
 try{
  const state=JSON.parse(await readFile(statePath,'utf8'));
  if(state.port<4173||state.port>4193||path.resolve(state.root)!==here)return null;
  const response=await fetch(`http://${host}:${state.port}/__afterimage_health`,{signal:AbortSignal.timeout(1200)});
  const value=await response.json();
  return value.tool==='afterimage'&&path.resolve(value.root)===here&&value.pid===state.pid?state:null;
 }catch{return null;}
}
async function check(){
 await access(path.join(root,'index.html'));await access(path.join(root,'models','resources.json'));
 const html=await readFile(path.join(root,'index.html'),'utf8');
 for(const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)){
  if(/^(https?:|data:|#)/i.test(match[1]))continue;
  await access(path.resolve(root,match[1].replace(/^\//,'')));
 }
 console.log('OK: entry assets and offline model manifest are present.');
}
async function start(){
 await check();let state=await health();
 if(!state){
  const log=await open(logPath,'a');
  try{const child=spawn(process.execPath,[filename,'--no-open'],{cwd:here,detached:true,stdio:['ignore',log.fd,log.fd],windowsHide:true});child.unref();}
  finally{await log.close();}
  for(let i=0;i<80;i++){await new Promise(r=>setTimeout(r,125));state=await health();if(state)break;}
 }
 if(!state)throw Error('Local server did not start. Ask your Agent to inspect startup.log.');
 const url=`http://${host}:${state.port}/`;console.log('READY '+url);browser(url);
}
async function stop(){
 const state=await health();if(!state){console.log('No running server for this folder.');return;}
 const response=await fetch(`http://${host}:${state.port}/__afterimage_stop`,{method:'POST',headers:{'X-Afterimage-Token':state.token},signal:AbortSignal.timeout(2500)});
 if(!response.ok)throw Error('Stop was refused; no foreign processes were stopped.');
 console.log('Stopped this local tool.');
}
async function serve(){
 await check();const token=randomBytes(24).toString('hex');
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://local');
  if(url.pathname==='/__afterimage_health'&&req.method==='GET'){
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify({tool:'afterimage',root:here,pid:process.pid}));
  }
  if(url.pathname==='/__afterimage_stop'&&req.method==='POST'){
   const received=Buffer.from(String(req.headers['x-afterimage-token']||'')),expected=Buffer.from(token);
   if(received.length!==expected.length||!timingSafeEqual(received,expected)){res.writeHead(403);return res.end('Forbidden');}
   res.writeHead(200);res.end('Stopped');server.close();
   try{const state=JSON.parse(await readFile(statePath,'utf8'));if(state.pid===process.pid)await unlink(statePath);}catch{}
   setTimeout(()=>process.exit(0),100).unref();return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);return res.end();}
  let file;
  try{
   file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
   if(file!==root&&!file.startsWith(root+path.sep))throw Error('outside');
   if((await stat(file)).isDirectory())file=path.join(file,'index.html');
   if(!(await stat(file)).isFile())throw Error('not a file');
  }catch{res.writeHead(404);return res.end('Local file not found.');}
  res.writeHead(200,{'Content-Type':mime[path.extname(file).toLowerCase()]||'application/octet-stream',
   'Cache-Control':/^[a-f0-9]{64}$/.test(path.basename(file))?'public, max-age=31536000, immutable':'no-cache',
   'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
  if(req.method==='HEAD')return res.end();const stream=createReadStream(file);stream.on('error',()=>res.end());stream.pipe(res);
 });
 for(let port=4173;port<=4193;port++){
  const ok=await new Promise((resolve,reject)=>{
   const failed=error=>{server.off('listening',success);error.code==='EADDRINUSE'?resolve(false):reject(error);};
   const success=()=>{server.off('error',failed);resolve(true);};server.once('error',failed);server.once('listening',success);server.listen(port,host);
  });
  if(!ok)continue;
  await writeFile(statePath,JSON.stringify({root:here,pid:process.pid,port,token}));
  const url=`http://${host}:${port}/`;console.log('READY '+url);browser(url);return;
 }
 throw Error('Ports 4173-4193 are occupied.');
}
const action=process.argv.includes('--check')?check:process.argv.includes('--stop')?stop:process.argv.includes('--start')?start:serve;
action().catch(error=>{console.error(error.message);process.exitCode=1;});

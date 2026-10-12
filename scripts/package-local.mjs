// Copyright 2026 Anyu. SPDX-License-Identifier: AGPL-3.0-only
import {cp,mkdir,readdir,readFile,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),tag=process.argv[2]||'v'+JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;
if(!/^v\d+\.\d+\.\d+$/.test(tag))throw Error('Use vX.Y.Z');
const destination=path.join(root,'outputs','剪影生成器-桌面本地工具包-'+tag);
try{await stat(destination);throw Error('Refusing to overwrite existing package: '+destination);}catch(error){if(error.code!=='ENOENT')throw error;}
await stat(path.join(root,'dist','models','resources.json'));await stat(path.join(root,'LICENSE'));
await mkdir(destination,{recursive:true});await cp(path.join(root,'dist'),path.join(destination,'app'),{recursive:true});
const source=path.join(destination,'source');await mkdir(source,{recursive:true});
for(const name of ['src','licenses','vendor','package.json','package-lock.json','index.html','vite.config.ts','tsconfig.json','tsconfig.app.json','LICENSE','THIRD-PARTY-NOTICES.md','.gitignore']){
 await cp(path.join(root,name),path.join(source,name),{recursive:true});
}
await mkdir(path.join(source,'public'),{recursive:true});
for(const name of ['assets','backgrounds','licenses','about.html'])await cp(path.join(root,'public',name),path.join(source,'public',name),{recursive:true});
await mkdir(path.join(source,'scripts'),{recursive:true});
for(const name of ['prepare-models.mjs','collect-licenses.mjs','package-local.mjs','local-templates'])await cp(path.join(root,'scripts',name),path.join(source,'scripts',name),{recursive:true});
await mkdir(path.join(source,'docs'),{recursive:true});
for(const name of ['AGENT-INSTALL.md','USER-GUIDE.md','BUILDING.md','OPEN-SOURCE-LICENSE.md'])await cp(path.join(root,'docs',name),path.join(source,'docs',name));
for(const name of ['LICENSE','THIRD-PARTY-NOTICES.md','licenses','vendor'])await cp(path.join(root,name),path.join(destination,name),{recursive:true});
for(const [file,target] of [['AGENT-INSTALL.md','AGENT-INSTALL.md'],['USER-GUIDE.md','使用说明书.md'],['OPEN-SOURCE-LICENSE.md','开源许可证说明.md'],['BUILDING.md','source/README.md']])await cp(path.join(root,'docs',file),path.join(destination,target));
const launchers=['local-server.mjs','local-server.py','START-WINDOWS.cmd','STOP-WINDOWS.cmd','START-MAC.command','STOP-MAC.command','START-LINUX.sh','STOP-LINUX.sh'];
for(const name of launchers){
 for(const folder of [destination,source]){
  await cp(path.join(root,'scripts','local-templates',name),path.join(folder,name));
  if(name.endsWith('.cmd')){const content=await readFile(path.join(folder,name),'utf8');await writeFile(path.join(folder,name),content.replace(/\r?\n/g,'\r\n'));}
 }
}
await writeFile(path.join(destination,'ONE-LINE-PROMPT.txt'),'请完整解压并安装这个剪影生成器桌面本地工具包，按 AGENT-INSTALL.md 检查运行环境、启动本地网页并验证上传照片和 PNG 导出；不要部署公网、不要上传我的照片，完成后告诉我启动和停止的方法。');
await writeFile(path.join(destination,'README-FIRST.md'),'# 剪影生成器 '+tag+'\n\n作者：安鱼 · https://www.anyusj.com/\n\n把整个 ZIP 发给其他用户，让他们将 ONE-LINE-PROMPT.txt 交给自己的 AI Agent。安装任务书见 AGENT-INSTALL.md，使用说明见 使用说明书.md，开源许可见 LICENSE 和 开源许可证说明.md。\n\nWindows 双击 START-WINDOWS.cmd；Mac/Linux 用对应 START 文件。需要 Node.js 或 Python 3（Agent 可以按自身权限帮助安装）。成功后启动窗口自动退出，本地服务后台运行；停止用 STOP-*。只监听本机，端口 4173–4193。不要直接双击 app/index.html。\n\n模型与九张背景已携带，首次识别也能离线。成品无需 npm install。source 是对应源码（不重复装模型；离线重建从 app/models 复制到 source/public/models）。licenses 和 vendor 保留第三方许可及 AGPL 依赖精确源码。\n\n不使用 PowerShell 隐藏启动，不设置开机自启，不要求关闭安全防护。首次缺少运行环境或从源码构建时需要联网；本地处理照片不联网、不上传。\n\n本轮实测 Windows Chrome；Mac/Linux 脚本提供但未宣称真机测试。大图内存和模型误识别仍有限制。程序采用 AGPL-3.0-only，并非官方认证、MIT 或闭源商用授权。背景另有素材许可。\n');
const files=[];
async function walk(folder){for(const entry of await readdir(folder,{withFileTypes:true})){
 const file=path.join(folder,entry.name);if(entry.isDirectory())await walk(file);
 else{const bytes=await readFile(file);files.push({file:path.relative(destination,file).replaceAll('\\','/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
}}
await walk(destination);
await writeFile(path.join(destination,'PACKAGE-MANIFEST.json'),JSON.stringify({version:tag,localOnly:true,desktopOnly:true,modelIncluded:true,backgroundCount:9,files},null,2));
console.log(destination);console.log('Files: '+files.length+'; bytes: '+files.reduce((sum,file)=>sum+file.bytes,0));

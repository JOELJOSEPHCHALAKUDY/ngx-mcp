const configuredBase=new URL(process.env.HOLDOUT_BASE_URL??'http://127.0.0.1:4342');
if(configuredBase.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(configuredBase.hostname))throw new Error('Holdout browser execution requires a local HTTP app');
export const base=configuredBase.origin;
export const seedTodos=[{title:'Read fixture article',completed:false},{title:'Clean fixture inbox',completed:false},{title:'Reserve fixture table',completed:true}];
export async function installIsolation(page,appBase=base){
 const network={blocked:[],apiRequests:[]};
 await page.route('**/*',async route=>{const request=route.request();const url=new URL(request.url());if(url.origin!==appBase){network.blocked.push(request.url());await route.abort('blockedbyclient');}else{if(/\/api\//.test(url.pathname))network.apiRequests.push({method:request.method(),url:request.url()});await route.continue();}});
 return network;
}
export async function seedThroughUi(page,appBase=base){
 await page.goto(appBase+'/#/all',{waitUntil:'networkidle'});
 await page.locator('input.new-todo').waitFor();
 for(const todo of seedTodos){await page.locator('.new-todo').fill(todo.title);await page.locator('.new-todo').press('Enter');}
 await page.locator('app-todo-item').filter({hasText:seedTodos[2].title}).locator('input.toggle').check();
}
export async function snapshot(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));return {url:page.url(),rows:await page.locator('app-todo-item li').evaluateAll(rows=>rows.map(row=>({title:row.querySelector('label').textContent,completed:row.querySelector('input.toggle').checked,editing:row.classList.contains('editing')}))),activeCount:await page.locator('.todo-count strong').textContent().catch(()=>null),input:await page.locator('.new-todo').inputValue()};}

/** A replay owns its local server; an occupied unrelated port is never reused implicitly. */
export async function startFixtureServer(sourceDirectory){
 const {spawn}=await import('node:child_process');
 const {createServer}=await import('node:net');
 const {resolve}=await import('node:path');
 const port=await new Promise((accept,reject)=>{const reservation=createServer();reservation.once('error',reject);reservation.listen(0,'127.0.0.1',()=>{const address=reservation.address();reservation.close(()=>accept(address.port));});});
 const child=spawn(process.execPath,[resolve(sourceDirectory,'node_modules/@angular/cli/bin/ng.js'),'serve','--host','127.0.0.1','--port',String(port)],{cwd:sourceDirectory,env:{...process.env,NG_CLI_ANALYTICS:'false'},stdio:['ignore','pipe','pipe']});
 let logs='',finished=false,failure;
 child.stdout.on('data',data=>{logs=(logs+String(data)).slice(-200000);});child.stderr.on('data',data=>{logs=(logs+String(data)).slice(-200000);});child.on('error',error=>{failure=error;finished=true;});child.on('exit',()=>{finished=true;});
 const close=async()=>{if(finished)return;child.kill('SIGTERM');const deadline=Date.now()+5000;while(!finished&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));if(!finished)child.kill('SIGKILL');};
 const baseUrl='http://127.0.0.1:'+port;const deadline=Date.now()+120000;
 while(Date.now()<deadline&&!finished){
  try{const response=await fetch(baseUrl,{signal:AbortSignal.timeout(1000)});if(response.ok)return {baseUrl,logs:()=>logs,close};}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 await close();throw new Error('Pinned-source Angular server did not start: '+(failure?.message??logs));
}

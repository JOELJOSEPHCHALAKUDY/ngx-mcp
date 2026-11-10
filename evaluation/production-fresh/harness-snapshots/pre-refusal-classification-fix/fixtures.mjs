import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname,resolve,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';

export const directory=dirname(fileURLToPath(import.meta.url));
export const catalog=JSON.parse(readFileSync(join(directory,'projects.json'),'utf8'));
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const readJson=path=>JSON.parse(readFileSync(path,'utf8'));
export const project=id=>{const value=catalog.projects.find(item=>item.id===id);assert(value,'Unknown fresh project: '+id);return value;};
export const labels=id=>readJson(join(directory,id,'labels.json'));
export const sourceDirectory=id=>resolve(process.env['PRODUCTION_SOURCE_'+id.toUpperCase()]??project(id).sourceDefault);
export function assertFrozen(id){
 const source=sourceDirectory(id),freeze=readJson(join(directory,id,'freeze.json'));
 for(const[name,digest]of Object.entries(freeze.files))assert.equal(hash(readFileSync(join(directory,id,name))),digest,'Frozen evidence changed: '+id+'/'+name);
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim(),project(id).commit);
 const manifest=readJson(join(directory,id,'source-manifest.json'));
 for(const[name,digest]of Object.entries(manifest))assert.equal(hash(readFileSync(join(source,name))),digest,'Upstream source changed: '+id+'/'+name);
 const extra=execFileSync('git',['ls-files','--others','--exclude-standard','--','src'],{cwd:source,encoding:'utf8'}).trim();assert.equal(extra,'','Upstream source has untracked additions');
 return {source,commit:project(id).commit,sourceFiles:Object.keys(manifest).length,labelsSha256:freeze.files['labels.json'],lockSha256:project(id).lockSha256};
}
export const clone=value=>structuredClone(value);
export function seedData(id,caseId){
 const fixture=labels(id).fixtures;
 if(id==='todo')return {'todo-items':caseId==='toggle_second_task'||caseId==='delete_second_task'?fixture.twoTasks:[]};
 if(id==='sprint')return {users:caseId==='register_user'?[]:[fixture.user,fixture.otherUser],projects:caseId==='create_task'?[fixture.project]:[],tasks:[]};
 return {'expense-tracker.v1':{categories:caseId==='create_category'?[]:fixture.categories,expenses:[]}};
}
export async function freshContext(browser,id,caseId,baseUrl,{seed}={}){
 const context=await browser.newContext({locale:'en-US',timezoneId:'UTC'});
 const allowed=new URL(baseUrl).origin,blocked=[];
 await context.route('**/*',async route=>{if(new URL(route.request().url()).origin!==allowed){blocked.push(route.request().url());await route.abort();}else await route.continue();});
 await context.addInitScript(data=>{if(!sessionStorage.getItem('__fresh_initialized')){localStorage.clear();for(const[key,value]of Object.entries(data))localStorage.setItem(key,JSON.stringify(value));sessionStorage.setItem('__fresh_initialized','1');}},seed??seedData(id,caseId));
 const page=await context.newPage();await page.clock.setFixedTime(new Date(catalog.clock));
 return {context,page,blocked};
}
export async function storageSnapshot(page,id){return page.evaluate(keys=>Object.fromEntries(keys.map(key=>[key,JSON.parse(localStorage.getItem(key)??'null')])),project(id).storageKeys);}
export async function settle(page){await page.waitForTimeout(220);}
export function nativeDriver(page){return {
 async fill(locator,value){assert.equal(await locator.count(),1,'Native fill must identify one exact field');const type=await locator.getAttribute('type');if(type==='checkbox')await locator.setChecked(value);else await locator.fill(String(value));await locator.blur();await settle(page);},
 async activate(locator,{expectUnavailable=false}={}){assert.equal(await locator.count(),1,'Native action must identify one exact element');if(expectUnavailable){await assert.rejects(locator.click({timeout:1200}),/not enabled|disabled|Timeout/);return {refused:true,reason:'disabled'};}await locator.click({timeout:2500});await settle(page);},
 async select(locator,value,{label}={}){assert.equal(await locator.count(),1);if((await locator.evaluate(node=>node.tagName))==='MAT-SELECT'){await this.activate(locator);await this.activate(page.getByRole('option',{name:label??String(value),exact:true}));}else{await locator.selectOption(String(value));await locator.blur();await settle(page);}},
 async submit(form){assert.equal(await form.count(),1);await this.activate(form.locator('button[type=submit]'));},
 };}
export async function prepareCase(page,id,caseId,baseUrl){
 const item=labels(id).cases.find(item=>item.id===caseId);assert(item);
 if(id==='sprint'&&!['register_user','login_user'].includes(caseId)){
  await page.goto(new URL('/login',baseUrl).href);await page.locator('input[name=username]').fill('fixture-user');await page.locator('input[name=password]').fill('Synthetic-Pass-481');await page.locator('button[type=submit]').click();await page.waitForURL('**/dashboard');
 }
 await page.goto(new URL(item.route,baseUrl).href);
 if(id==='todo')await page.locator('app-add-todo').waitFor();
 else if(id==='sprint')await page.locator(caseId==='register_user'?'input[name=email]':caseId==='login_user'?'input[name=username]':caseId==='create_task'?'.kanban-header':'h1').waitFor();
 else await page.locator(caseId==='create_category'?'#category-name':caseId==='change_one_budget'?'#budget-cat-groceries':'#expense-description').waitFor();
 await settle(page);return item;
}
export async function executeCase(page,id,item,driver){
 const input=item.input;
 if(id==='todo'){
  if(['create_task','empty_title_native_quirk'].includes(item.id)){
   await driver.activate(page.locator('button[data-bs-target="#addTodoModal"]'));await page.locator('#addTodoModal.show').waitFor();
   await driver.fill(page.locator('#todoTitle'),input.title);await driver.fill(page.locator('#todoDescription'),input.description);await driver.fill(page.locator('#todoCompleted'),input.completed);
   await driver.activate(page.locator('#addTodoModal button').filter({hasText:/^\s*Add\s*$/}));
  }else{
   const row=page.locator('app-item-view').filter({hasText:'Second fixture task'});
   await driver.activate(item.id==='toggle_second_task'?row.locator('input[type=checkbox]'):row.locator('button[title="Delete item"]'));
  }
 }else if(id==='sprint'){
  if(['register_user','login_user'].includes(item.id)){
   await driver.fill(page.locator('input[name=username]'),input.username);
   if(item.id==='register_user')await driver.fill(page.locator('input[name=email]'),input.email);
   await driver.fill(page.locator('input[name=password]'),input.password);await driver.submit(page.locator('form'));
  }else if(item.id==='create_task'){
   await driver.activate(page.getByRole('button',{name:/Add Task/}));const dialog=page.locator('mat-dialog-container');await dialog.waitFor();
   await driver.fill(dialog.locator('input[name=title]'),input.title);await driver.fill(dialog.locator('textarea[name=description]'),input.description);
   await driver.select(dialog.locator('mat-select[name=status]'),input.status,{label:'In Progress'});await driver.activate(dialog.getByRole('button',{name:'Create',exact:true}));
  }else{
   await driver.activate(page.getByRole('button',{name:/Create Project/}));const dialog=page.locator('mat-dialog-container');await dialog.waitFor();
   await driver.fill(dialog.locator('input[name=name]'),input.name);await driver.fill(dialog.locator('textarea[name=description]'),input.description);
   if(item.id==='empty_project_blocked'){const disabled=dialog.getByRole('button',{name:'Create',exact:true});assert.equal(await disabled.isDisabled(),true,'Original source disables an empty project');await driver.activate(disabled,{expectUnavailable:true});}
   else await driver.activate(dialog.getByRole('button',{name:item.id==='cancel_project'?'Cancel':'Create',exact:true}));
  }
 }else{
  if(item.id==='create_category'){
   await driver.fill(page.locator('#category-name'),input.name);await driver.submit(page.locator('app-category-form form'));
  }else if(item.id==='change_one_budget'){
   await driver.fill(page.locator('#budget-cat-groceries'),'456,78');await driver.submit(page.locator('app-budget-form form'));
  }else{
   await driver.fill(page.locator('#expense-description'),input.description);await driver.fill(page.locator('app-money-input input'),item.ui.uiMappings.amountOre);await driver.fill(page.locator('#expense-date'),input.date);await driver.select(page.locator('#expense-category'),input.categoryId);await driver.submit(page.locator('app-expense-form-page form'),{expectInvalid:item.kind==='negative-native'});
  }
 }
 await page.waitForTimeout(id==='expense'?1000:350);
}
function fields(actual,expected,message){for(const[key,value]of Object.entries(expected))assert.deepEqual(actual[key],value,message+': '+key);}
export async function verifyCase(page,id,item,before){
 const after=await storageSnapshot(page,id),input=item.input;
 if(id==='todo'){
  const rows=after['todo-items'];assert(Array.isArray(rows));
  if(['create_task','empty_title_native_quirk'].includes(item.id))assert.deepEqual(rows,[item.expected.storageAdded]);
  else if(item.id==='toggle_second_task'){assert.equal(rows.length,2);assert.deepEqual(rows[0],before['todo-items'][0]);assert.deepEqual(rows[1],item.expected.storageChanged);}
  else assert.deepEqual(rows,[before['todo-items'][0]]);
 }else if(id==='sprint'){
  if(item.id==='register_user'){
   assert.equal(after.users.length,1);assert.deepEqual(Object.keys(after.users[0]).sort(),['id','username','email','password','createdAt'].sort());fields(after.users[0],item.expected.userFields,'Registered user');assert.equal(typeof after.users[0].id,'string');assert(after.users[0].id.length>0);assert.equal(after.users[0].createdAt,catalog.clock);assert.equal(after.currentUser,null);assert.equal(new URL(page.url()).pathname,'/login');
  }else if(item.id==='login_user'){assert.deepEqual(after.currentUser,item.expected.currentUser);assert.deepEqual(after.users,before.users);assert.equal(new URL(page.url()).pathname,'/dashboard');}
  else if(item.id==='create_project'){
   assert.equal(after.projects.length,before.projects.length+1);const created=after.projects.at(-1);assert.deepEqual(Object.keys(created).sort(),['id','name','description','ownerId','createdAt','updatedAt'].sort());fields(created,item.expected.projectFields,'Created project');assert.equal(typeof created.id,'string');assert(created.id.length>0);assert.equal(created.createdAt,catalog.clock);assert.equal(created.updatedAt,catalog.clock);assert.deepEqual(after.projects.slice(0,-1),before.projects);assert.deepEqual(after.tasks,before.tasks);
  }else if(item.id==='create_task'){
   assert.equal(after.tasks.length,1);const created=after.tasks[0];assert.deepEqual(Object.keys(created).sort(),['id','title','description','status','projectId','dueDate','createdAt','updatedAt'].sort());fields(created,item.expected.taskFields,'Created task');assert.equal(typeof created.id,'string');assert(created.id.length>0);assert.equal(created.createdAt,catalog.clock);assert.equal(created.updatedAt,catalog.clock);assert.deepEqual(after.projects,before.projects);
  }else{assert.deepEqual(after,before);if(item.id==='cancel_project')assert.equal(await page.locator('mat-dialog-container').count(),0);}
  if(item.id!=='register_user')assert.deepEqual(after.users,before.users,'User fixture must not be changed by unrelated operation');
 }else{
  const db=after['expense-tracker.v1'],previous=before['expense-tracker.v1'];
  if(item.kind==='negative-native'){
   assert.deepEqual(db,previous);if(item.id==='required_description')assert((await page.locator('body').innerText()).includes(item.expected.visibleErrorContains));
   if(item.id==='zero_amount')assert.equal(await page.locator('app-money-input input').getAttribute('aria-invalid'),'true');
   if(item.id==='future_date')assert.equal(await page.locator('#expense-date').getAttribute('aria-invalid'),'true');
  }else if(item.id==='create_category'){
   assert.equal(db.categories.length,1);assert.deepEqual(db.categories[0],{id:item.expected.generatedCategoryId,...item.expected.categoryFields});assert.deepEqual(db.expenses,previous.expenses);
  }else if(item.id==='create_expense'){
   assert.deepEqual(db.expenses,[item.expected.expenseFields]);assert.deepEqual(db.categories,previous.categories);assert.equal(new URL(page.url()).pathname,'/expenses');
  }else{
   assert.equal(db.categories.length,previous.categories.length);const expected=clone(previous);expected.categories.find(category=>category.id===input.categoryId).monthlyBudgetOre=input.monthlyBudgetOre;assert.deepEqual(db,expected);
  }
 }
 return {passed:true,before,after,url:new URL(page.url()).pathname};
}
export async function runCase(page,id,caseId,baseUrl,driver=nativeDriver(page)){
 const item=await prepareCase(page,id,caseId,baseUrl),before=await storageSnapshot(page,id);
 await executeCase(page,id,item,driver);return verifyCase(page,id,item,before);
}
export function createStaticServer(browserDirectory,port=0){
 const folder=resolve(browserDirectory);
 const server=createServer((request,response)=>{
  let file;try{file=resolve(folder,'.'+decodeURIComponent(new URL(request.url??'/','http://local').pathname));}catch{response.writeHead(400);response.end();return;}
  if(file!==folder&&!file.startsWith(folder+sep)){response.writeHead(403);response.end();return;}
  if(!existsSync(file)||!readdirSafeFile(file))file=join(folder,'index.html');
  const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':file.endsWith('.svg')?'image/svg+xml':'text/html';
  response.writeHead(200,{'content-type':type});response.end(readFileSync(file));
 });
 return {server,async start(){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});return 'http://127.0.0.1:'+server.address().port;},async close(){await new Promise(resolve=>server.close(resolve));}};
}
function readdirSafeFile(file){try{readdirSync(file);return false;}catch{return true;}}

import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:http';
import {chromium,type Browser} from 'playwright';
import {hash} from '../src/hash.js';
import {toolName} from '../src/approval.js';
import {certify,certificationReport} from '../src/certification.js';
import type {Capability,Manifest} from '../src/model.js';

// An app in which most actions cannot run on a freshly opened page, as a development server shows it:
//  - the notes it lists ship with the app as a file (/assets/notes.json), and archiving one needs the identifier of one;
//  - the account form is behind a guard, and the sign-out button is shown only to a visitor who has a token; the login
//    form stores one in localStorage;
//  - the todo list is kept in the page's memory only, and a todo's remove button exists only once a todo was added.
let server:Server,browser:Browser,baseUrl:string,ownFileReads=0,apiReads=0,mutations=0;
const page=`<!doctype html><html><body><app-shell><nav><a class="home" href="/">Home</a></nav></app-shell><main></main><script>
const main=document.querySelector('main'),todos=[];let seq=0;
const go=path=>{history.pushState({},'',path);render();};
function renderTodos(){main.querySelector('ul').innerHTML=todos.map(todo=>'<li>'+todo.title+' <button class="remove" type="button" data-id="'+todo.id+'">Remove</button></li>').join('');}
function render(){
 const path=location.pathname;
 if(path==='/login'){
  main.innerHTML='<app-login><form><input name="username"><input name="password" type="password"><button type="submit">Sign in</button></form></app-login>';
  main.querySelector('form').onsubmit=event=>{event.preventDefault();fetch('/api/login',{method:'POST',body:JSON.stringify({username:main.querySelector('input').value})}).then(r=>r.json()).then(body=>{localStorage.setItem('token',String(body.token));location.assign('/');});};
 }
 else if(path==='/account'){
  if(!localStorage.getItem('token')){go('/login');return;}
  main.innerHTML='<app-account><form><input name="displayName"><button type="submit">Save</button></form></app-account>';
  main.querySelector('form').onsubmit=event=>{event.preventDefault();fetch('/api/account',{method:'PUT',body:JSON.stringify({displayName:main.querySelector('input').value})});};
 }
 else if(path==='/todos'){
  main.innerHTML='<app-todos><form class="add"><input name="title"><button type="submit">Add</button></form><ul></ul></app-todos>';
  main.querySelector('form').onsubmit=event=>{event.preventDefault();const title=main.querySelector('input').value;todos.push({id:++seq,title});fetch('/api/todos',{method:'POST',body:JSON.stringify({title})});renderTodos();};
  main.querySelector('ul').onclick=event=>{const button=event.target.closest('button.remove');if(!button)return;todos.splice(todos.findIndex(todo=>String(todo.id)===button.dataset.id),1);fetch('/api/todos/'+button.dataset.id,{method:'DELETE'});renderTodos();};
  renderTodos();
 }
 else if(path==='/notes'){
  main.innerHTML='<app-notes><ul></ul></app-notes>';fetch('/api/notes/count');
  fetch('/assets/notes.json').then(r=>r.json()).then(list=>{if(Array.isArray(list))main.querySelector('ul').innerHTML=list.map(note=>'<li><a href="/notes/'+note.id+'">'+note.title+'</a></li>').join('');});
 }
 else if(path.startsWith('/notes/')){main.innerHTML='<app-note><button class="archive" type="button">Archive</button></app-note>';main.querySelector('button').onclick=()=>fetch('/api/notes/'+path.split('/')[2],{method:'DELETE'});}
 else main.innerHTML='<app-home><p>Welcome</p></app-home>';
}
document.addEventListener('click',event=>{const link=event.target.closest('a[href]');if(link&&link.origin===location.origin){event.preventDefault();go(link.pathname);}});
window.addEventListener('popstate',render);
if(localStorage.getItem('token')){const out=document.createElement('button');out.className='signout';out.type='button';out.textContent='Sign out';out.onclick=()=>{localStorage.removeItem('token');go('/login');};document.querySelector('app-shell nav').append(out);}
render();
</script></body></html>`;
before(async()=>{
 server=createServer((request,response)=>{
  if(request.method!=='GET'){mutations++;response.writeHead(200,{'content-type':'application/json'});response.end('{}');return;}
  if(request.url==='/assets/notes.json'){ownFileReads++;response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify([{id:'n1',title:'First'},{id:'n2',title:'Second'}]));return;}
  if(request.url?.startsWith('/api/')){apiReads++;response.writeHead(200,{'content-type':'application/json'});response.end('{"count":2}');return;}
  response.writeHead(200,{'content-type':'text/html'});response.end(page);
 });
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));baseUrl=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 browser=await chromium.launch();
});
after(async()=>{await browser?.close();await new Promise<void>(done=>server?.close(()=>done()));});

function app():Manifest{
 const source={file:'state-chain-fixture',line:1};
 const common=():Pick<Capability,'fingerprint'|'fields'|'callPath'|'bindings'|'outputSchema'|'guards'|'workflow'|'issues'|'status'>=>({fingerprint:'',fields:[],callPath:[],bindings:[],outputSchema:{type:'object'},guards:[],workflow:{confirmation:'not-observed',evidence:[]},issues:[],status:'candidate'});
 const none={type:'object',properties:{},additionalProperties:false};
 const text=(name:string,type='text'):Capability['fields'][number]=>({name,selector:`input[name="${name}"]`,element:'input',type,required:true,supported:true,schema:{type:'string'},adapter:'native'});
 const capabilities:Capability[]=[
  {...common(),id:'fixture/login',route:'/login',component:'LoginFixture',componentSelector:'app-login',handler:'login',
   action:{kind:'form',selector:'app-login form',label:'Sign in',event:'submit',expression:'login()',source},fields:[text('username'),text('password')],
   inputSchema:{type:'object',properties:{username:{type:'string'},password:{type:'string'}},required:['username','password'],additionalProperties:false}},
  {...common(),id:'fixture/saveAccount',route:'/account',component:'AccountFixture',componentSelector:'app-account',handler:'save',guards:['requireAuth'],
   action:{kind:'form',selector:'app-account form',label:'Save',event:'submit',expression:'save()',source},fields:[text('displayName')],
   inputSchema:{type:'object',properties:{displayName:{type:'string'}},required:['displayName'],additionalProperties:false}},
  {...common(),id:'fixture/signOut',route:'/',component:'ShellFixture',componentSelector:'app-shell',handler:'signOut',global:true,
   action:{kind:'button',selector:'app-shell button.signout',label:'Sign out',event:'click',expression:'signOut()',source},inputSchema:none},
  {...common(),id:'fixture/addTodo',route:'/todos',component:'TodosFixture',componentSelector:'app-todos',handler:'add',
   action:{kind:'form',selector:'app-todos form.add',label:'Add',event:'submit',expression:'add()',source},fields:[text('title')],
   inputSchema:{type:'object',properties:{title:{type:'string'}},required:['title'],additionalProperties:false}},
  {...common(),id:'fixture/removeTodo',route:'/todos',component:'TodosFixture',componentSelector:'app-todos',handler:'remove',
   action:{kind:'button',selector:'app-todos button.remove',label:'Remove',event:'click',expression:'remove(todo)',source},inputSchema:none},
  {...common(),id:'fixture/archiveNote',route:'/notes/:id',component:'NoteFixture',componentSelector:'app-note',handler:'archive',routeParams:['id'],
   action:{kind:'button',selector:'app-note button.archive',label:'Archive',event:'click',expression:'archive()',source},
   inputSchema:{type:'object',properties:{id:{type:'string',minLength:1}},required:['id'],additionalProperties:false}},
 ];
 const manifest:Manifest={formatVersion:1,compilerVersion:'0.1.0',sourceDigest:'state-chain-fixture',diagnostics:[],capabilities,
  routes:[{path:'/',component:'HomeFixture',guards:[]},{path:'/login',component:'LoginFixture',guards:[]},{path:'/account',component:'AccountFixture',guards:['requireAuth']},{path:'/todos',component:'TodosFixture',guards:[]},{path:'/notes',component:'NotesFixture',guards:[]},{path:'/notes/:id',component:'NoteFixture',guards:[]}]};
 for(const capability of capabilities)capability.fingerprint=hash(JSON.stringify({sourceDigest:manifest.sourceDigest,capability}));
 return manifest;
}

test('an action that cannot run on a fresh page is certified in the state the app\'s own actions leave behind',{timeout:600000},async()=>{
 const source=app(),result=await certify(browser,source,{baseUrl,budget:6});
 const entry=(id:string)=>result.entries.find(candidate=>candidate.id===`fixture/${id}`)!;
 const approval=(id:string)=>result.approvals.find(candidate=>candidate.id===`fixture/${id}`);
 const tool=(id:string)=>toolName(result.manifest.capabilities.find(candidate=>candidate.id===`fixture/${id}`)!);
 const ran=(id:string)=>assert.ok(['proven','executed'].includes(entry(id).verdict),JSON.stringify(entry(id)));

 // The notes are a file of the app itself: the dev server serves it in the default sandbox, and the identifier comes from it.
 ran('archiveNote');assert.equal(entry('archiveNote').after,undefined);
 assert.deepEqual(result.manifest.capabilities.find(candidate=>candidate.id==='fixture/archiveNote')!.observed?.http.filter(call=>call.method!=='GET'),[{method:'DELETE',path:'/api/notes/n1',bodyKeys:[]}]);
 assert.deepEqual(result.conditions.ownFiles,['/assets/notes.json']);

 // What ran on a fresh page names no other action.
 ran('login');assert.equal(entry('login').after,undefined);
 ran('addTodo');assert.equal(entry('addTodo').after,undefined);

 // The login form left a token in storage: the guarded form and the sign-out button ran in a session that starts from it.
 ran('saveAccount');assert.deepEqual(entry('saveAccount').after,['LoginFixture.login on /login']);
 ran('signOut');assert.deepEqual(entry('signOut').after,['LoginFixture.login on /login']);
 assert.match(approval('saveAccount')!.description,new RegExp(`It ran only in the state left by ${tool('login')} \\(LoginFixture\\.login on /login\\)\\.$`));

 // The todo list lives in memory: the remove button ran after the add form had run in the same page. Nothing it needs
 // comes from the session, so the session is not named.
 ran('removeTodo');assert.deepEqual(entry('removeTodo').after,['TodosFixture.add on /todos']);
 assert.match(approval('removeTodo')!.description,new RegExp(`It ran only in the state left by ${tool('addTodo')} \\(TodosFixture\\.add on /todos\\)\\.$`));

 // Proposals keep the manifest's order, whatever order the actions were certified in.
 assert.deepEqual(result.approvals.map(candidate=>candidate.id),source.capabilities.map(capability=>capability.id));
 // What the earlier actions were given is not written anywhere a reviewer or an agent reads: one of them is a password.
 const report=certificationReport(result);
 assert.ok(!/aaa/.test(report+JSON.stringify([result.entries,result.approvals])));
 assert.match(report,/3 of the actions that ran did so only in the state another certified action left behind/);
 assert.match(report,/\| \/account \| AccountFixture\.save \| write \| [^|]* \| ran only after LoginFixture\.login on \/login/);
 assert.match(report,/Sandbox: the only requests that left the browser were reads \(GET, HEAD\) of the app's own files from its dev server \(\/assets\/notes\.json\); every other request was answered by the sandbox with an empty document\./);
 assert.ok(ownFileReads>0,'the notes file was read from the dev server');
 assert.deepEqual([apiReads,mutations],[0,0]);
});

test('with exploring turned off every action is tried on a freshly opened page only',{timeout:300000},async()=>{
 const result=await certify(browser,app(),{baseUrl,budget:6,explore:0,only:capability=>['fixture/addTodo','fixture/removeTodo'].includes(capability.id)});
 const entry=(id:string)=>result.entries.find(candidate=>candidate.id===`fixture/${id}`)!;
 assert.ok(['proven','executed'].includes(entry('addTodo').verdict),JSON.stringify(entry('addTodo')));
 assert.equal(entry('removeTodo').verdict,'unverified');assert.equal(entry('removeTodo').after,undefined);
 assert.deepEqual(result.approvals.map(approval=>approval.id),['fixture/addTodo']);
 assert.equal(mutations,0);
});

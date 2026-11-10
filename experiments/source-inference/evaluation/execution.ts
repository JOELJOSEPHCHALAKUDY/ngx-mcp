import assert from 'node:assert/strict';
import {chromium,type Browser,type BrowserContext,type Page} from 'playwright';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {Ajv} from 'ajv';
import {browserAdapter} from '../src/browser-adapter.js';
import {createMcpServer} from '../src/mcp.js';
import {sampleUrl,type Sample} from '../src/samples.js';
import {isolateSample,redact} from '../samples/isolation.js';
import type {Capability,Manifest} from '../src/model.js';
import type {GoldAction,Json} from './metrics.js';
const accountKey='angular-15-signup-verification-boilerplate-accounts';
const otherAccount={id:2,title:'Mr',firstName:'Other',lastName:'Person',email:'other@example.test',role:'User',password:'Synthetic-123',isVerified:true,dateCreated:'2026-01-01T00:00:00.000Z',refreshTokens:[]};
const fixtureAccount={id:1,title:'Ms',firstName:'Fixture',lastName:'Admin',email:'admin@example.test',role:'Admin',password:'Synthetic-123',isVerified:true,dateCreated:'2026-01-01T00:00:00.000Z',refreshTokens:[],resetToken:'ground-truth-reset',resetTokenExpires:'2099-01-01T00:00:00.000Z',verificationToken:'ground-truth-verification'};
export async function prepare(context:BrowserContext,page:Page,sample:Sample,action:GoldAction){
 const fixture=await isolateSample(context,sample);const origin=sampleUrl(sample);
 if(sample.id==='signup'){
   // Data setup only. Authentication state is obtained through the original public login UI.
   await context.addInitScript(({key,account,other})=>{if(!sessionStorage.getItem('ground-truth-seeded')){localStorage.setItem(key,JSON.stringify([account,other]));sessionStorage.setItem('ground-truth-seeded','true');}},{key:accountKey,account:action.id==='signup.verify-email'?{...fixtureAccount,isVerified:false}:fixtureAccount,other:otherAccount});
   if(action.context?.auth){
     await page.goto(origin+'/account/login');
     await page.locator('[formcontrolname="email"]').fill(fixtureAccount.email);
     await page.locator('[formcontrolname="password"]').fill(fixtureAccount.password);
     await page.getByRole('button',{name:'Login',exact:true}).click();
     await page.waitForURL(url=>url.pathname==='/',{timeout:10000});
     await page.waitForLoadState('networkidle');
   }
 }
 if(sample.id==='realworld'){
   // Isolation blocks the external icon font, which leaves icon-only controls with no box; give them the size the font would.
   await context.addInitScript(()=>{addEventListener('DOMContentLoaded',()=>{const st=document.createElement('style');st.textContent='i[class^="ion-"]{display:inline-block;width:16px;height:16px}';document.head.append(st);});});
   const followed=new Set<string>();
   let user={username:'Katherine',email:'katherine@example.test',token:'synthetic-test-token',bio:'',image:''};
   const own=['realworld.article-delete','realworld.article-update','realworld.comment-delete'].includes(action.id);
   const articles=[1,2].map((n)=>({slug:n===1?'ground-truth-article':'other-article',title:`Fixture article ${n}`,description:'Fixture description',body:'Fixture body',tagList:[],createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',favorited:false,favoritesCount:0,author:{username:own&&n===1?'Katherine':'OtherAuthor',bio:'',image:'',following:false}}));
   // Last route wins in Playwright. Unknown endpoints fall through to the deny-by-default sample isolation.
   await context.route('**/*',async route=>{
     const request=route.request(),url=new URL(request.url());let endpoint=url.pathname.replace(/^\/api/,'');
     const api=url.pathname.startsWith('/api/')||url.origin!==origin;
     const method=request.method();const json=(body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':origin},body:JSON.stringify(body)});
     if(!api||method==='OPTIONS')return route.fallback();
     if(method==='GET'&&endpoint==='/user')return json({user});
     if(method==='GET'&&/^\/profiles\//.test(endpoint)){const name=decodeURIComponent(endpoint.split('/')[2]);return json({profile:{...(name===user.username?user:{username:name,bio:'',image:''}),following:followed.has(name)}});}
     if(['POST','DELETE'].includes(method)&&/^\/profiles\/[^/]+\/follow$/.test(endpoint)){const name=decodeURIComponent(endpoint.split('/')[2]);fixture.writes.push({method,path:url.pathname,body:null});if(method==='POST')followed.add(name);else followed.delete(name);return json({profile:{username:name,bio:'',image:'',following:followed.has(name)}});}
     if(method==='POST'&&/^\/articles\/[^/]+\/comments$/.test(endpoint)){const body=request.postDataJSON();fixture.writes.push({method,path:url.pathname,body});return json({comment:{id:1,body:body.comment?.body,createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',author:{username:user.username,bio:'',image:'',following:false}}},201);}
     if(method==='DELETE'&&/^\/articles\/[^/]+(\/comments\/\d+)?$/.test(endpoint)){fixture.writes.push({method,path:url.pathname,body:null});return json({},200);}
     if(method==='PUT'&&/^\/articles\/[^/]+$/.test(endpoint)){const body=request.postDataJSON();fixture.writes.push({method,path:url.pathname,body});Object.assign(articles[0],body.article);return json({article:articles[0]});}
     if(method==='GET'&&['/articles','/articles/feed'].includes(endpoint)){fixture.state.reads.push(url.search);return json({articles,articlesCount:40});}
     if(method==='GET'&&endpoint==='/articles/ground-truth-article')return json({article:articles[0]});
     if(method==='GET'&&endpoint.endsWith('/comments'))return json({comments:action.id==='realworld.comment-delete'?[{id:'1',body:'Fixture comment',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',author:{username:user.username,bio:'',image:'',following:false}}]:[]});
     if((method==='POST'&&['/users','/users/login'].includes(endpoint))||(method==='PUT'&&endpoint==='/user')){
       const body=request.postDataJSON();fixture.writes.push({method,path:url.pathname,body});user={...user,...body.user,token:'synthetic-test-token'};return json({user});
     }
     if(method==='POST'&&endpoint==='/articles'){
       const body=request.postDataJSON();fixture.writes.push({method,path:url.pathname,body});
       if(!body.article?.title||!body.article?.description||!body.article?.body)return json({errors:{body:['Article fields required by fixture API']}},422);
       Object.assign(articles[0],body.article,{author:{...user,following:false}});return json({article:articles[0]},201);
     }
     if(['POST','DELETE'].includes(method)&&/^\/articles\/[^/]+\/favorite$/.test(endpoint)){
       const article=articles.find(a=>endpoint.includes('/'+a.slug+'/'))!;fixture.writes.push({method,path:url.pathname,body:null});article.favorited=method==='POST';article.favoritesCount=article.favorited?1:0;return json({article});
     }
     return route.fallback();
   });
   if(action.context?.auth)await context.addInitScript(()=>{if(!sessionStorage.getItem('ground-truth-auth-seeded')){localStorage.setItem('jwtToken','synthetic-test-token');sessionStorage.setItem('ground-truth-auth-seeded','true');}});
 }
 if(action.context?.preparePath){await page.goto(origin+action.context.preparePath);await page.waitForLoadState('networkidle');}
 if(sample.id==='course-crud'&&action.id!=='course-crud.create')for(let n=1;n<=(action.id==='course-crud.paginate'?12:1);n++)fixture.courses.push({_id:String(n),name:`Seeded course ${n}`,category:'Back-end',lessons:[{_id:1,name:'Seeded lesson',youtubeUrl:'zyxwvutsrqp'}]});
 if(action.id==='course-crud.retry')fixture.state.failList=1;
 const query=action.context?.query?new URLSearchParams(action.context.query).toString():'';
 // Set up the documented gold context. Adapter is free to navigate according to its generated plan.
 const start=action.id==='signup.verify-email'?'/':action.routes.find(r=>!r.includes(':'))??'/';await page.goto(origin+start+(query?'?'+query:''));
 await page.waitForLoadState('networkidle');
 // The app opens a modal error dialog after the failed load; a user must dismiss it before retrying.
 if(action.id==='course-crud.retry'){await page.getByRole('button',{name:'Close'}).click();await page.getByRole('button',{name:'Close'}).waitFor({state:'detached',timeout:5000});}
 if(action.id==='signup.reset-password'){await page.locator('form').waitFor({state:'visible',timeout:10000});await page.waitForURL(url=>url.search==='',{timeout:5000});}
 return fixture;
}
async function oracle(page:Page,sample:Sample,action:GoldAction,fixture:Awaited<ReturnType<typeof prepare>>){
 const args=action.validInput,id=action.id;
 // The adapter returns dispatch, not domain completion. Give the source-defined outcome time to occur.
 const paths:Record<string,string>={'user-crud.create':'/users','user-crud.update':'/users','signup.admin-update':'/admin/accounts','signup.login':'/','signup.register':'/account/login','signup.reset-password':'/account/login','signup.admin-create':'/admin/accounts','signup.profile-update':'/profile','signup.profile-delete':'/account/login','course-crud.create':'/courses','course-crud.update':'/courses','realworld.login':'/','realworld.register':'/','realworld.article-create':'/article/ground-truth-article','realworld.settings-update':'/profile/Katherine','realworld.logout':'/'};
 if(paths[id])await page.waitForURL(url=>url.pathname===paths[id],{timeout:10000});
 if(sample.id==='user-crud'){
   const records=await page.evaluate(()=>JSON.parse(localStorage.getItem('angular-14-crud-example-users')??'[]'));
   if(id==='user-crud.delete'){await page.waitForFunction(()=>JSON.parse(localStorage.getItem('angular-14-crud-example-users')??'[]').length===0,null,{timeout:5000});assert.equal(new URL(page.url()).pathname,'/users');return {remaining:0};}
   if(id==='user-crud.update'){const r=records.find((x:Json)=>String(x.id)===args.id);assert(r,'Updated user missing');for(const key of ['title','firstName','lastName','email','role'])assert.equal(r[key],args[key]);assert.equal(records.length,1);return {record:redact(r)};}
   const record=records.find((r:Json)=>r.email===args.email);assert(record,'Created user missing from original backend storage');
   for(const key of ['title','firstName','lastName','email','role'])assert.equal(record[key],args[key]);
   assert.equal(new URL(page.url()).pathname,'/users');return {record:redact(record)};
 }
 if(sample.id==='signup'){
   const records:Json[]=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'[]'),accountKey);
   if(id.endsWith('.login')){assert(records[0].refreshTokens.length>0,'No auth refresh token created');assert.equal(new URL(page.url()).pathname,'/');}
   else if(id.endsWith('.register')||id.endsWith('.admin-create')){
     const record=records.find(r=>r.email===args.email);assert(record,'Account not persisted');for(const key of ['title','firstName','lastName','email'])assert.equal(record[key],args[key]);
     assert.equal(record.isVerified,id.endsWith('.admin-create'));assert.equal(new URL(page.url()).pathname,id.endsWith('.register')?'/account/login':'/admin/accounts');
   }else if(id.endsWith('.forgot-password')){assert(records[0].resetToken!=='ground-truth-reset','Reset token unchanged');assert(Date.parse(records[0].resetTokenExpires)>Date.now());}
   else if(id.endsWith('.reset-password')){assert.equal(records[0].password,args.password);assert(!records[0].resetToken);assert.equal(new URL(page.url()).pathname,'/account/login');}
   else if(id.endsWith('.profile-update')){for(const key of ['title','firstName','lastName','email'])assert.equal(records[0][key],args[key]);assert.equal(records[0].password,fixtureAccount.password);assert.equal(new URL(page.url()).pathname,'/profile');}
   else if(id.endsWith('.profile-delete')){assert(!records.some(r=>r.id===fixtureAccount.id),'Account not deleted');assert.equal(records.length,1);assert.equal(new URL(page.url()).pathname,'/account/login');}
   else if(id==='signup.admin-delete'){await page.waitForFunction(({key,gone})=>!JSON.parse(localStorage.getItem(key)??'[]').some((r:Json)=>String(r.id)===gone),{key:accountKey,gone:String(args.id)},{timeout:5000});const now:Json[]=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'[]'),accountKey);assert.equal(now.length,1);}
   else if(id==='signup.admin-update'){const r=records.find(x=>String(x.id)===args.id);assert(r,'Account missing');for(const key of ['title','firstName','lastName','email','role'])assert.equal(r[key],args[key]);assert.equal(r.password,otherAccount.password);assert.equal(new URL(page.url()).pathname,'/admin/accounts');}
   else if(id==='signup.verify-email'){await page.waitForURL(url=>url.pathname==='/account/login',{timeout:5000});const now:Json[]=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'[]'),accountKey);assert.equal(now.find(r=>r.id===fixtureAccount.id)?.isVerified,true);}
   else if(id==='signup.logout'){await page.waitForURL(url=>url.pathname==='/account/login',{timeout:5000});const now:Json[]=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'[]'),accountKey);assert.equal(now.find(r=>r.id===fixtureAccount.id)?.refreshTokens.length,0);}
   else throw new Error('Missing signup oracle');
   return {accounts:redact(records),path:new URL(page.url()).pathname};
 }
 if(sample.id==='forms-course'&&id==='forms-course.upload-thumbnail'){
   const deadline=Date.now()+5000;while(Date.now()<deadline&&!fixture.writes.length)await new Promise(r=>setTimeout(r,100));
   assert.equal(fixture.writes.length,1);const upload=fixture.writes[0];assert(upload.path.endsWith('/thumbnail-upload'));assert(String((upload.body as Json).multipart).includes('thumbnail.png'),'Uploaded filename missing');
   assert.equal(await page.locator('file-upload input[matinput]').inputValue(),'thumbnail.png');return {uploaded:true};
 }
 if(sample.id==='forms-course'&&id==='forms-course.query-lessons'){
   const wanted=(q:string)=>{const p=new URLSearchParams(q);return p.get('filter')===args.filter&&p.get('sortOrder')===args.sort&&p.get('pageNumber')===String(args.page)&&p.get('pageSize')===String(args.pageSize);};
   const deadline=Date.now()+5000;while(Date.now()<deadline&&!fixture.state.reads.some(wanted))await new Promise(r=>setTimeout(r,100));
   assert(fixture.state.reads.some(wanted),'Requested filter/sort/page was not loaded');return {reads:fixture.state.reads.slice(-3)};
 }
 if(sample.id==='forms-course'){
   const draft=await page.evaluate(()=>JSON.parse(localStorage.getItem('STEP_1')??'null'));assert(draft,'No valid persisted draft');
   for(const key of ['title','downloadsAllowed','longDescription'])assert.equal(draft[key],args[key]);assert.equal(draft.category,'ADVANCED');
   await page.reload();await page.waitForLoadState('networkidle');assert.equal(await page.locator('[formcontrolname="title"]').inputValue(),args.title);
   return {draft,restored:true};
 }
 if(sample.id==='course-crud'){
   if(id==='course-crud.paginate'){
     const wanted=(q:string)=>{const p=new URLSearchParams(q);return p.get('page')===String(args.page)&&p.get('pageSize')===String(args.pageSize);};
     const deadline=Date.now()+5000;while(Date.now()<deadline&&!fixture.state.reads.some(wanted))await new Promise(r=>setTimeout(r,100));
     assert(fixture.state.reads.some(wanted),'Requested page/size was not fetched');return {reads:fixture.state.reads};
   }
   if(id==='course-crud.delete'){
     // The application asks for confirmation in a modal; the human confirms, the tool never does.
     await page.locator('#yesBtn').click();
     const deadline=Date.now()+5000;while(Date.now()<deadline&&!fixture.writes.length)await new Promise(r=>setTimeout(r,100));
     assert.equal(fixture.writes.length,1);assert.equal(fixture.writes[0].method,'DELETE');assert(fixture.writes[0].path.endsWith('/courses/1'));assert.equal(fixture.courses.length,0);return {writes:fixture.writes};
   }
   if(id==='course-crud.retry'){await page.locator('mat-toolbar',{hasText:'Available Courses'}).waitFor({state:'visible',timeout:5000});assert.equal(await page.locator('.load-error').count(),0);assert(fixture.state.listReads>=2,'No fresh load');return {reads:fixture.state.listReads};}
   if(id==='course-crud.update'){assert.equal(fixture.writes.length,1);const w=fixture.writes[0];assert.equal(w.method,'PUT');assert(w.path.endsWith('/courses/1'));const b=w.body as Json;assert.equal(b.name,args.name);assert.equal(b.category,args.category);assert.deepEqual(b.lessons.map(({name,youtubeUrl}:Json)=>({name,youtubeUrl})),args.lessons);return {writes:fixture.writes};}
   assert.equal(fixture.writes.length,1);const record=fixture.writes[0].body as Json;assert.equal(record.name,args.name);assert.equal(record.category,args.category);
   assert.deepEqual(record.lessons.map(({name,youtubeUrl}:Json)=>({name,youtubeUrl})),args.lessons);
   assert.equal(new URL(page.url()).pathname,'/courses');await page.getByText(String(args.name),{exact:true}).waitFor({state:'visible',timeout:5000});return {writes:fixture.writes};
 }
 if(id==='realworld.paginate'){
   const fetched=()=>fixture.state.reads.some(q=>{const p=new URLSearchParams(q);const limit=Number(p.get('limit'));return limit>0&&Number(p.get('offset'))===(Number(args.page)-1)*limit;});
   const deadline=Date.now()+5000;while(Date.now()<deadline&&!fetched())await new Promise(r=>setTimeout(r,100));
   assert(fetched(),'Requested page was not fetched with the matching limit/offset');return {reads:fixture.state.reads};
 }
 if(id.endsWith('.logout')){assert.equal(await page.evaluate(()=>localStorage.getItem('jwtToken')),null);assert.equal(new URL(page.url()).pathname,'/');return {tokenRemoved:true};}
 assert.equal(fixture.writes.length,1,'Expected exactly one business mutation');const write=fixture.writes[0],body=write.body as Json;
 if(id.endsWith('.login')||id.endsWith('.register')){
   assert.equal(write.path.replace(/^\/api/,''),id.endsWith('.login')?'/users/login':'/users');for(const key of Object.keys(args))assert.equal(body.user[key],args[key]);
   assert.equal(await page.evaluate(()=>localStorage.getItem('jwtToken')),'synthetic-test-token');assert.equal(new URL(page.url()).pathname,'/');
 }else if(id.endsWith('.settings-update')){
   assert.equal(write.method,'PUT');for(const key of Object.keys(args))assert.equal(body.user[key],args[key]);assert(!body.user.password);assert.equal(new URL(page.url()).pathname,'/profile/Katherine');
 }else if(id.endsWith('.article-create')){
   assert.equal(write.method,'POST');for(const key of Object.keys(args))assert.equal(body.article[key],args[key]);assert.equal(new URL(page.url()).pathname,'/article/ground-truth-article');
 }else if(id.endsWith('.comment-delete')){assert.equal(write.method,'DELETE');assert(write.path.endsWith('/articles/ground-truth-article/comments/1'));
 }else if(id.endsWith('.follow')){assert.equal(write.method,'POST');assert(write.path.endsWith('/profiles/OtherAuthor/follow'));
 }else if(id.endsWith('.comment-add')){assert.equal(write.method,'POST');assert(write.path.endsWith('/articles/ground-truth-article/comments'));assert.equal(body.comment.body,args.body);await page.getByText(String(args.body),{exact:true}).waitFor({state:'visible',timeout:5000});
 }else if(id.endsWith('.article-delete')){assert.equal(write.method,'DELETE');assert(write.path.endsWith('/articles/ground-truth-article'));assert.equal(new URL(page.url()).pathname,'/');
 }else if(id.endsWith('.article-update')){assert.equal(write.method,'PUT');assert(write.path.endsWith('/articles/ground-truth-article'));for(const key of ['title','description','body'])assert.equal(body.article[key],args[key]);assert.equal(new URL(page.url()).pathname,'/article/ground-truth-article');
 }else if(id.endsWith('.favorite')){assert(write.path.endsWith('/articles/ground-truth-article/favorite'));}
 else throw new Error('Missing RealWorld oracle');
 return {writes:redact(fixture.writes),path:new URL(page.url()).pathname};
}
export async function executeAction(browser:Browser,sample:Sample,action:GoldAction,manifest:Manifest,capability:Capability){
 const start=Date.now();const context=await browser.newContext({viewport:{width:1400,height:1100},serviceWorkers:'block'});const page=await context.newPage();page.setDefaultTimeout(6000);
 const pageErrors:string[]=[];page.on('pageerror',error=>pageErrors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 const client=new Client({name:'ground-truth-evaluator',version:'1.0.0'});let server:ReturnType<typeof createMcpServer>|undefined;
 let outputConforms:boolean|undefined;let stage='fixture',dispatch:unknown,fixture:Awaited<ReturnType<typeof prepare>>|undefined;
 try{
   fixture=await prepare(context,page,sample,action);
   const adapter=browserAdapter(page,manifest,[{id:capability.id,fingerprint:capability.fingerprint,description:`Isolated benchmark only: ${action.effect}`,effect:'write'}],sampleUrl(sample));
   server=createMcpServer(adapter);const [a,b]=InMemoryTransport.createLinkedPair();await Promise.all([client.connect(a),server.connect(b)]);
   stage='tool';const listed=await client.listTools();assert.equal(listed.tools.length,1);dispatch=await client.callTool({name:listed.tools[0].name,arguments:action.validInput});
   assert(!(dispatch as Json).isError,JSON.stringify(dispatch));
   const structured=(dispatch as Json).structuredContent;const validate=new Ajv({strict:false}).compile(capability.outputSchema);outputConforms=Boolean(validate(structured));assert(outputConforms,'Tool return violates its generated output schema');
   stage='oracle';const evidence=await oracle(page,sample,action,fixture);assert.deepEqual(pageErrors,[],'Uncaught upstream error');
   return {status:'passed',stage,outputConforms,evidence,elapsedMs:Date.now()-start,pageErrors,blockedExternal:fixture.blocked};
 }catch(error){return {status:stage==='fixture'?'infrastructure-error':'failed',stage,outputConforms,finalPath:new URL(page.url()).pathname,reason:error instanceof Error?error.message:String(error),dispatch:redact(dispatch),writes:redact(fixture?.writes),elapsedMs:Date.now()-start,pageErrors,blockedExternal:fixture?.blocked??[]};}
 finally{await client.close();await server?.close();await context.close();}
}
export {chromium};

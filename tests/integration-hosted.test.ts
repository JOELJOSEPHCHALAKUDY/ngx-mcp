import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request as httpRequest} from 'node:http';
import {randomUUID} from 'node:crypto';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {ListToolsRequestSchema,CallToolRequestSchema,LATEST_PROTOCOL_VERSION} from '@modelcontextprotocol/sdk/types.js';
import {createLocalJWKSet,exportJWK,generateKeyPair,SignJWT} from 'jose';
import {chromium} from 'playwright';
import {createHostedMcpServer,createJwtAccessVerifier,createBrowserSessionFactory,validateApplicationUrl,type HostedPrincipal,type HostedAuditEvent} from '../src/integration-hosted.js';

const publicUrl='https://mcp.example.test/mcp',issuer='https://issuer.example.test';
const principal=(subject:string,scopes=['ngx-mcp:use','ngx-mcp:read','ngx-mcp:write'],clientId='trusted-client'):HostedPrincipal=>({issuer,subject,clientId,scopes,expiresAt:Math.floor(Date.now()/1000)+300,resource:publicUrl});
const initialize={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:LATEST_PROTOCOL_VERSION,capabilities:{},clientInfo:{name:'hosted-conformance',version:'1'}}};
function simpleServer(subject:string,contextId:string,onMutation:()=>void=()=>{}){
 const server=new Server({name:'hosted-fixture',version:'1'},{capabilities:{tools:{}}});
 server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[
  {name:'whoami',description:'Read the isolated session identity',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'increment',description:'Change this isolated session',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'unconfigured',description:'Must never be exposed without a scope mapping',inputSchema:{type:'object',properties:{}}}
 ]}));
 server.setRequestHandler(CallToolRequestSchema,async request=>{
  if(request.params.name==='increment')onMutation();
  return {content:[{type:'text',text:JSON.stringify({subject,contextId})}],structuredContent:{subject,contextId}};
 });return server;
}
async function startGateway(extra:Partial<Parameters<typeof createHostedMcpServer>[0]>={}){
 const audit:HostedAuditEvent[]=[],sessions:{subject:string;id:string;closed:boolean;authorized:number}[]=[];let mutated=0;
 const tokens=new Map([
  ['alice',principal('alice')],['bob',principal('bob')],['alice-read',principal('alice',['ngx-mcp:use','ngx-mcp:read'])],
  ['alice-other-client',principal('alice',undefined,'another-client')],['no-scope',principal('alice',[])],
  ['wrong-issuer',{...principal('alice'),issuer:'https://other-issuer.example'}],['wrong-resource',{...principal('alice'),resource:'https://other.example/mcp'}],['expired',{...principal('alice'),expiresAt:1}]
 ]);
 const gateway=createHostedMcpServer({publicUrl,tlsTerminatedByProxy:true,authorizationServers:[issuer],allowedHosts:['127.0.0.1'],allowedOrigins:['https://client.example'],toolScopes:{whoami:['ngx-mcp:read'],increment:['ngx-mcp:write']},
  verifyAccessToken:async token=>{const value=tokens.get(token);if(!value)throw new Error('denied');return value;},audit:event=>{audit.push(event);},
  createSession:async actor=>{
   const state={subject:actor.subject,id:randomUUID(),closed:false,authorized:0};sessions.push(state);
   const server=simpleServer(actor.subject,state.id,()=>mutated++);
   return {server,authorize:async()=>{state.authorized++;},close:async()=>{state.closed=true;await server.close();}};
  },...extra});
 const address=await gateway.listen(0);assert(address&&typeof address!=='string');const url='http://127.0.0.1:'+address.port;
 const call=async(token:string|undefined,payload:unknown=initialize,session?:string,headers:Record<string,string>={},method='POST')=>{
  const requestHeaders={Accept:'application/json, text/event-stream',...(method==='POST'?{'Content-Type':'application/json'}:{}),...token?{Authorization:'Bearer '+token}:{},...session?{'Mcp-Session-Id':session}:{},...headers};
  const requestBody=method==='POST'?(typeof payload==='string'?payload:JSON.stringify(payload)):undefined;
  if(headers['Host'])return new Promise<Response>((done,reject)=>{
   const request=httpRequest(url+'/mcp',{method,headers:requestHeaders},response=>{const chunks:Buffer[]=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>done(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:response.headers as Record<string,string>})));});
   request.on('error',reject);request.end(requestBody);
  });
  return fetch(url+'/mcp',{method,headers:requestHeaders,...requestBody!==undefined?{body:requestBody}:{}});
 };
 const init=async(token:string)=>{const response=await call(token);assert.equal(response.status,200,await response.clone().text());const id=response.headers.get('mcp-session-id');assert(id);await response.json();const notified=await call(token,{jsonrpc:'2.0',method:'notifications/initialized'},id);assert.equal(notified.status,202);return id;};
 return {gateway,url,call,init,audit,sessions,get mutated(){return mutated;}};
}

test('JWT access verification checks signature, issuer, audience, client, expiry, scopes and revocation',async()=>{
 const keys=await generateKeyPair('ES256'),jwk=await exportJWK(keys.publicKey);jwk.kid='pinned';
 let revoked=false;
 const verify=createJwtAccessVerifier({issuer,audience:publicUrl,keySet:createLocalJWKSet({keys:[jwk]}),requiredScopes:['ngx-mcp:use'],isRevoked:()=>revoked});
 const sign=async(claims:Record<string,unknown>={})=>new SignJWT({scope:'ngx-mcp:use ngx-mcp:read',client_id:'client',...claims}).setProtectedHeader({alg:'ES256',kid:'pinned'}).setIssuer(String(claims['iss']??issuer)).setAudience(String(claims['aud']??publicUrl)).setSubject('alice').setExpirationTime(Number(claims['exp']??Math.floor(Date.now()/1000)+60)).sign(keys.privateKey);
 const valid=await sign();const actor=await verify(valid);assert.equal(actor.subject,'alice');assert.equal(actor.resource,publicUrl);assert.equal(actor.clientId,'client');assert.deepEqual(actor.scopes,['ngx-mcp:read','ngx-mcp:use']);
 for(const claims of [{iss:'https://other-issuer.example'},{aud:'https://other-resource.example'},{exp:1},{client_id:null},{scope:'unrelated'}])await assert.rejects(verify(await sign(claims)));
 const parts=valid.split('.');parts[1]=Buffer.from(JSON.stringify({iss:issuer,aud:publicUrl,sub:'admin',exp:4102444800,client_id:'client',scope:'ngx-mcp:use'})).toString('base64url');await assert.rejects(verify(parts.join('.')));
 revoked=true;await assert.rejects(verify(valid),/revoked/);
 assert.throws(()=>createJwtAccessVerifier({issuer,audience:publicUrl,jwksUrl:'http://evil.example/jwks'}),/HTTPS/);
 assert.throws(()=>createJwtAccessVerifier({issuer,audience:publicUrl,keySet:createLocalJWKSet({keys:[jwk]}),algorithms:['HS256' as any]}),/asymmetric/);
});

test('HTTP gateway authenticates every request and isolates principals, clients, scopes and sessions',async()=>{
 const f=await startGateway();try{
  for(const token of [undefined,'invalid','expired','wrong-resource','wrong-issuer']){const result=await f.call(token);assert.equal(result.status,401);assert.match(result.headers.get('www-authenticate')??'',/resource_metadata/);assert.match(result.headers.get('www-authenticate')??'',/ngx-mcp:read/);}
  assert.equal((await f.call('no-scope')).status,403);assert.equal(f.sessions.length,0,'Denied tokens do not create an app session');
  const alice=await f.init('alice'),bob=await f.init('bob');assert.notEqual(alice,bob);
  const invoke=async(token:string,id:string)=>{const response=await f.call(token,{jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'whoami',arguments:{}}},id);assert.equal(response.status,200);return (await response.json() as any).result.structuredContent;};
  const a=await invoke('alice',alice),b=await invoke('bob',bob);assert.equal(a.subject,'alice');assert.equal(b.subject,'bob');assert.notEqual(a.contextId,b.contextId);
  for(const token of ['bob','alice-other-client','alice-read'])assert.equal((await f.call(token,{jsonrpc:'2.0',id:5,method:'tools/list'},alice)).status,404,'An existing MCP session is not authentication');
  assert.equal((await f.call(undefined,{jsonrpc:'2.0',id:6,method:'tools/list'},alice)).status,401);
  const read=await f.init('alice-read');
  const listed=await f.call('alice-read',{jsonrpc:'2.0',id:7,method:'tools/list'},read);assert.equal(listed.status,200);assert.deepEqual((await listed.json() as any).result.tools.map((tool:any)=>tool.name),['whoami']);
  const deniedWrite=await f.call('alice-read',{jsonrpc:'2.0',id:8,method:'tools/call',params:{name:'increment',arguments:{}}},read);assert.equal(deniedWrite.status,403);assert.match(deniedWrite.headers.get('www-authenticate')??'',/ngx-mcp:write/);assert.equal(f.mutated,0);
  assert.equal((await f.call('alice',{jsonrpc:'2.0',id:9,method:'tools/call',params:{name:'unconfigured',arguments:{}}},alice)).status,403);
  assert.equal((await f.call('alice',{jsonrpc:'2.0',id:10,method:'tools/call',params:{name:'increment',arguments:{}}},alice)).status,200);assert.equal(f.mutated,1);
  await f.gateway.revokePrincipal(principal('alice'));assert.equal((await f.call('alice',{jsonrpc:'2.0',id:11,method:'tools/list'},alice)).status,401);assert(f.sessions.filter(session=>session.subject==='alice').every(session=>session.closed));
  const deleted=await f.call('bob',undefined,bob,{},'DELETE');assert.equal(deleted.status,200);assert.equal((await f.call('bob',{jsonrpc:'2.0',id:12,method:'tools/list'},bob)).status,404);
  assert(f.sessions.every(session=>session.authorized>0));
  const logged=JSON.stringify(f.audit);assert(!logged.includes('Bearer'));assert(!logged.includes('alice'));assert(!logged.includes('bob'));assert(!logged.includes('arguments'));assert(f.audit.some(event=>event.event==='session-closed'));
 }finally{await f.gateway.close();assert(f.sessions.every(session=>session.closed));}
});

test('HTTP boundaries reject hostile origins/hosts, oversized bodies, unsupported methods and excessive sessions',async()=>{
 const f=await startGateway({maxSessions:1,maxSessionsPerPrincipal:1,maxRequestBytes:1024});try{
  assert.equal((await f.call('alice',initialize,undefined,{Origin:'https://evil.example'})).status,403);
  assert.equal((await f.call('alice',initialize,undefined,{Host:'evil.example'})).status,403);
  assert.equal((await f.call('alice',initialize,undefined,{Host:'evil@127.0.0.1'})).status,403);
  assert.equal((await f.call('alice','x'.repeat(2048))).status,413);
  assert.equal((await f.call('alice','{broken')).status,400);
  assert.equal((await f.call('alice',initialize,undefined,{'Content-Type':'text/plain'})).status,415);
  const id=await f.init('alice');assert.equal((await f.call('bob')).status,429);assert.equal((await f.call('alice')).status,429);
  const metadata=await fetch(f.url+'/.well-known/oauth-protected-resource/mcp');assert.equal(metadata.status,200);assert.equal((await metadata.json() as any).resource,publicUrl);
  assert.equal((await f.call('alice',undefined,id,{},'PUT')).status,405);
  assert.equal((await f.call('alice',{jsonrpc:'2.0',id:99,method:'tools/list'},'not-a-session')).status,404);
 }finally{await f.gateway.close();}
 assert.throws(()=>createHostedMcpServer({publicUrl,authorizationServers:[issuer],verifyAccessToken:async()=>principal('a'),createSession:async()=>({} as any),audit:()=>{}}),/TLS termination/);
 assert.throws(()=>validateApplicationUrl('https://app.example'),/explicitly allowed/);
 assert.equal(validateApplicationUrl('https://app.example/tasks',['https://app.example']).origin,'https://app.example');
 assert.throws(()=>validateApplicationUrl('http://app.example',['http://app.example']),/HTTPS/);
 assert.throws(()=>validateApplicationUrl('https://user:password@app.example',['https://app.example']),/HTTPS/);
});

test('per-request app authorization failure closes the session before a tool can run',async()=>{
 let valid=true,calls=0,closed=false;
 const f=await startGateway({createSession:async actor=>{const server=simpleServer(actor.subject,'scoped',()=>calls++);return {server,authorize:async()=>{if(!valid)throw new Error('account changed');},close:async()=>{closed=true;await server.close();}};}});
 try{
  const id=await f.init('alice');valid=false;
  assert.equal((await f.call('alice',{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'increment',arguments:{}}},id)).status,403);assert.equal(calls,0);assert(closed);
  assert.equal((await f.call('alice',{jsonrpc:'2.0',id:3,method:'tools/list'},id)).status,404);
 }finally{await f.gateway.close();}
});

test('expired sessions and failed audit sinks fail closed without mutations',async()=>{
 const f=await startGateway({idleTimeoutMs:40});try{const id=await f.init('alice');await new Promise(done=>setTimeout(done,65));assert.equal((await f.call('alice',{jsonrpc:'2.0',id:2,method:'tools/list'},id)).status,404);}finally{await f.gateway.close();}
 let opened=0;
 const broken=await startGateway({audit:()=>{throw new Error('unavailable');},createSession:async()=>{opened++;throw new Error('must not open');}});try{assert.equal((await broken.call('alice')).status,503);assert.equal(opened,0);}finally{await broken.gateway.close();}
});

test('browser session factory uses distinct contexts and rejects account changes and unapproved network destinations',{timeout:60000},async()=>{
 let allowedRequests=0,blockedRequests=0;
 const allowed=createServer((request,response)=>{allowedRequests++;response.writeHead(200,{'content-type':'application/json'});response.end('{}');});
 const blocked=createServer((request,response)=>{blockedRequests++;response.end('must not reach');});
 const app=createServer((request,response)=>{response.writeHead(200,{'content-type':'text/html'});response.end(`<!doctype html><script>window.__angularMcpBridge={profile:'production',accessStatus:()=>({ready:true,subject:localStorage.getItem('subject'),sessionId:'session-'+localStorage.getItem('subject')+'-'+(localStorage.getItem('generation')||'1')}),assertIdentity:async(subject,session)=>{if(localStorage.getItem('subject')!==subject||session&&session!=='session-'+localStorage.getItem('subject')+'-'+(localStorage.getItem('generation')||'1'))throw new Error('identity mismatch')}}</script>`);});
 for(const server of [app,allowed,blocked])await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const url=(server:typeof app)=>'http://127.0.0.1:'+(server.address() as any).port;
 const browser=await chromium.launch();const pages=new Map<string,any>();
 const factory=createBrowserSessionFactory({browser,baseUrl:url(app),allowedNetworkOrigins:[url(allowed)],
  initialize:async(context,page,actor)=>{await context.addInitScript(subject=>{localStorage.setItem('subject',subject);},actor.subject);pages.set(actor.subject,page);},
  verifyApplicationIdentity:async(page,actor)=>page.evaluate(subject=>localStorage.getItem('subject')===subject,actor.subject),
  createMcpServer:async(page,base,actor)=>simpleServer(actor.subject,randomUUID())});
 let a:Awaited<ReturnType<typeof factory>>|undefined,b:Awaited<ReturnType<typeof factory>>|undefined;
 try{
  a=await factory(principal('alice'));b=await factory(principal('bob'));assert.equal(browser.contexts().length,2);
  assert.equal(await pages.get('alice').evaluate(()=>localStorage.getItem('subject')),'alice');assert.equal(await pages.get('bob').evaluate(()=>localStorage.getItem('subject')),'bob');
  await pages.get('alice').evaluate(async(destination:string)=>{await fetch(destination,{mode:'no-cors'});},url(allowed));assert.equal(allowedRequests,1);
  await pages.get('alice').evaluate(async(destination:string)=>{try{await fetch(destination,{mode:'no-cors'});}catch{}},url(blocked));assert.equal(blockedRequests,0);
  await pages.get('alice').evaluate(()=>localStorage.setItem('subject','bob'));await assert.rejects(a.authorize(),/identity mismatch/);await b.authorize();
  await pages.get('alice').evaluate(()=>{localStorage.setItem('subject','alice');localStorage.setItem('generation','2');});await assert.rejects(a.authorize(),/identity mismatch/,'A new login session for the same user cannot reuse the old MCP session');
  await pages.get('bob').evaluate(()=>{(globalThis as any).__angularMcpBridge.profile='development';});await assert.rejects(b.authorize(),/production access-controlled/);
 }finally{await a?.close();await b?.close();await browser.close();for(const server of [app,allowed,blocked])await new Promise<void>(done=>server.close(()=>done()));}
});

test('official MCP HTTP client works with verified JWT access and session termination',async()=>{
 const keys=await generateKeyPair('ES256'),jwk=await exportJWK(keys.publicKey);jwk.kid='http-key';
 const verify=createJwtAccessVerifier({issuer,audience:publicUrl,keySet:createLocalJWKSet({keys:[jwk]}),requiredScopes:['ngx-mcp:use']});
 const token=await new SignJWT({scope:'ngx-mcp:use ngx-mcp:read ngx-mcp:write',client_id:'sdk-client'}).setProtectedHeader({alg:'ES256',kid:'http-key'}).setIssuer(issuer).setAudience(publicUrl).setSubject('sdk-user').setExpirationTime('2m').sign(keys.privateKey);
 const f=await startGateway({verifyAccessToken:verify});const client=new Client({name:'hosted-http-sdk',version:'1'});
 const transport=new StreamableHTTPClientTransport(new URL(f.url+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+token}}});
 try{
  await client.connect(transport);const listed=await client.listTools();assert.deepEqual(listed.tools.map(tool=>tool.name),['whoami','increment']);
  const response=await client.callTool({name:'whoami',arguments:{}});assert.equal((response.structuredContent as any).subject,'sdk-user');
  await client.callTool({name:'increment',arguments:{}});assert.equal(f.mutated,1);
  await transport.terminateSession();assert.equal(f.gateway.sessionCount,0);assert(f.sessions.every(session=>session.closed));
 }finally{await client.close();await f.gateway.close();}
});

test('pending session creation counts against limits and revocation cancels creation',async()=>{
 let release:()=>void=()=>{};const gate=new Promise<void>(done=>{release=done;});let created=0,closed=0;
 const f=await startGateway({maxSessions:1,maxSessionsPerPrincipal:1,createSession:async actor=>{created++;await gate;const server=simpleServer(actor.subject,'pending');return {server,authorize:async()=>{},close:async()=>{closed++;await server.close();}};}});
 try{
  const initial=f.call('alice');for(let i=0;i<100&&created===0;i++)await new Promise(done=>setTimeout(done,5));assert.equal(created,1);
  assert.equal((await f.call('bob')).status,429);assert.equal((await f.call('alice')).status,429);
  await f.gateway.revokePrincipal(principal('alice'));release();assert.equal((await initial).status,503);assert.equal(closed,1);assert.equal(f.gateway.sessionCount,0);
 }finally{release();await f.gateway.close();}
});

test('session concurrency is reserved before asynchronous app authorization',async()=>{
 let hold=false,entered=0,release:()=>void=()=>{};const pause=new Promise<void>(done=>{release=done;});
 const f=await startGateway({maxConcurrentRequestsPerSession:1,createSession:async actor=>{const server=simpleServer(actor.subject,'concurrency');return {server,authorize:async()=>{if(hold){entered++;await pause;}},close:async()=>{await server.close();}};}});
 try{
  const id=await f.init('alice');hold=true;
  const pending=f.call('alice',{jsonrpc:'2.0',id:3,method:'tools/list'},id);
  for(let i=0;i<100&&entered===0;i++)await new Promise(done=>setTimeout(done,5));assert.equal(entered,1);
  assert.equal((await f.call('alice',{jsonrpc:'2.0',id:4,method:'tools/list'},id)).status,429);assert.equal(entered,1);
  release();assert.equal((await pending).status,200);
 }finally{release();await f.gateway.close();}
});

test('authentication deadlines do not release slots while verifier work is still pending',async()=>{
 let release:()=>void=()=>{},slow=true;const pending=new Promise<void>(done=>{release=done;});
 const f=await startGateway({callbackTimeoutMs:25,maxPendingAuthentications:1,verifyAccessToken:async()=>{if(slow)await pending;return principal('alice');}});
 try{
  assert.equal((await f.call('alice')).status,503);assert.equal(f.sessions.length,0);
  assert.equal((await f.call('alice')).status,429,'Timed-out verification still occupies its bounded background slot');
  slow=false;release();await new Promise(done=>setTimeout(done,5));const id=await f.init('alice');assert(id);
 }finally{release();await f.gateway.close();}
});

test('session creation deadlines retain reservations and close late-created resources',async()=>{
 let release:()=>void=()=>{},slow=true,closed=0;const pending=new Promise<void>(done=>{release=done;});
 const f=await startGateway({sessionCreationTimeoutMs:25,maxSessions:1,maxSessionsPerPrincipal:1,createSession:async actor=>{if(slow)await pending;const server=simpleServer(actor.subject,'late');return {server,authorize:async()=>{},close:async()=>{closed++;await server.close();}};}});
 try{
  assert.equal((await f.call('alice')).status,503);assert.equal(f.gateway.sessionCount,0);
  assert.equal((await f.call('bob')).status,429,'A timed-out factory keeps its resource reservation');
  slow=false;release();for(let i=0;i<100&&closed===0;i++)await new Promise(done=>setTimeout(done,5));assert.equal(closed,1);
  assert(await f.init('bob'));
 }finally{release();await f.gateway.close();}
 assert.equal(closed,2);
});

test('authorization and cleanup deadlines prevent dispatch and retain closing capacity',async()=>{
 let hold=false,releaseAuth:()=>void=()=>{},releaseClose:()=>void=()=>{},mutations=0;
 const auth=new Promise<void>(done=>{releaseAuth=done;}),closing=new Promise<void>(done=>{releaseClose=done;});
 const f=await startGateway({callbackTimeoutMs:25,maxSessions:1,maxSessionsPerPrincipal:1,createSession:async actor=>{const server=simpleServer(actor.subject,'slow',()=>mutations++);return {server,authorize:async()=>{if(hold)await auth;},close:async()=>{await closing;await server.close();}};}});
 try{
  const id=await f.init('alice');hold=true;
  assert.equal((await f.call('alice',{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'increment',arguments:{}}},id)).status,503);assert.equal(mutations,0);
  assert.equal((await f.call('bob')).status,429,'Closing resources still count against the bounded capacity');
  releaseAuth();releaseClose();for(let i=0;i<100&&f.gateway.sessionCount;i++)await new Promise(done=>setTimeout(done,5));assert.equal(f.gateway.sessionCount,0);
 }finally{releaseAuth();releaseClose();await f.gateway.close();}
});

test('failed cleanup does not advertise success or free capacity for leaked resources',async()=>{
 const f=await startGateway({maxSessions:1,maxSessionsPerPrincipal:1,createSession:async actor=>{const server=simpleServer(actor.subject,'cleanup-failed');return {server,authorize:async()=>{},close:async()=>{await server.close();throw new Error('cleanup failed');}};}});
 try{
  const id=await f.init('alice');await assert.rejects(f.gateway.closeSession(id),/cleanup/);
  assert.equal(f.gateway.sessionCount,1);assert.equal((await f.call('bob')).status,429);
  assert(!f.audit.some(event=>event.event==='session-closed'));assert(f.audit.some(event=>event.reason==='session_cleanup_failed'));
 }finally{await f.gateway.close();}
});

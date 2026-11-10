import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {readFileSync,existsSync,statSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {catalog} from './fixtures.mjs';

// Evaluation-only trusted server. Permission changes have no HTTP endpoint: only
// the out-of-page fixture controller can change them. The browser holds an
// HttpOnly random cookie, never its own identity or approval authority.
export function accessFixture(){
 let folder,origin;const sessions=new Map(),audit=[],approvals=[];
 const clock=Date.parse(catalog.clock);
 const json=(response,status,value)=>{response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(value));};
 const server=createServer(async(request,response)=>{
  const url=new URL(request.url??'/','http://local');
  if(url.pathname.startsWith('/__ngx_access/')){
   const token=(request.headers.cookie??'').split(';').map(value=>value.trim()).find(value=>value.startsWith('ngx_access='))?.slice(11),state=sessions.get(token);
   if(!state||state.revoked||state.session.expiresAt<=clock)return json(response,401,{error:'Unauthenticated'});
   if(request.headers.origin&&request.headers.origin!==origin)return json(response,403,{error:'Origin denied'});
   if(url.pathname==='/__ngx_access/session'&&request.method==='GET')return json(response,200,state.session);
   if(request.method!=='POST')return json(response,405,{error:'Method denied'});
   let body='',input;for await(const part of request){body+=part;if(body.length>1048576)return json(response,413,{error:'Too large'});}try{input=JSON.parse(body);}catch{return json(response,400,{error:'Invalid JSON'});}
   if(url.pathname==='/__ngx_access/authorize'){
    const permitted=!state.deniedSources.has(input.sourceId)&&!state.deniedOperations.has(input.operation);return json(response,200,{allowed:permitted});
   }
   if(url.pathname==='/__ngx_access/approval'){
    // The node-side controller owns approval. This records redacted challenges;
    // it never trusts a browser-supplied grant or identity.
    assert.equal(typeof input.requestHash,'string');
    approvals.push({sessionId:state.session.id,subject:state.session.subject,sourceId:input.sourceId,operation:input.operation,requestHash:input.requestHash,approved:state.approve});
    return json(response,200,{approved:state.approve});
   }
   if(url.pathname==='/__ngx_access/audit'){
    const allowed=['sequence','time','event','operation','sourceId','requestHash','code'];
    if(Object.keys(input).some(key=>!allowed.includes(key)))return json(response,400,{error:'Unexpected audit payload'});
    audit.push({sessionId:state.session.id,subject:state.session.subject,...input});return json(response,200,{ok:true});
   }
   return json(response,404,{error:'Not found'});
  }
  if(!folder)return json(response,503,{error:'Build not attached'});
  let file;try{file=resolve(folder,'.'+decodeURIComponent(url.pathname));}catch{return json(response,400,{error:'Bad path'});}
  if(file!==folder&&!file.startsWith(folder+sep))return json(response,403,{error:'Path denied'});
  if(!existsSync(file)||!statSync(file).isFile())file=join(folder,'index.html');
  const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':file.endsWith('.svg')?'image/svg+xml':'text/html';
  response.writeHead(200,{'content-type':type,'cache-control':'no-store'});response.end(readFileSync(file));
 });
 return {server,audit,approvals,
  async start(port=0){await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done);});origin='http://127.0.0.1:'+server.address().port;return origin;},
  attach(path){folder=resolve(path);},
  session(subject='synthetic-owner-a'){
   const token=randomBytes(32).toString('hex'),state={session:{id:randomBytes(16).toString('hex'),subject,expiresAt:clock+3600000},revoked:false,approve:true,deniedSources:new Set(),deniedOperations:new Set()};sessions.set(token,state);
   return {state,async attach(context){await context.addCookies([{name:'ngx_access',value:token,url:origin,httpOnly:true,sameSite:'Strict'}]);},revoke(){state.revoked=true;},expire(){state.session.expiresAt=clock-1;},denyApproval(){state.approve=false;},denySource(sourceId){state.deniedSources.add(sourceId);},denyOperation(operation){state.deniedOperations.add(operation);}};
  },
  async close(){server.closeAllConnections();await new Promise(done=>server.close(done));}
 };
}
export const accessBootstrapSource=String.raw`
export async function connectNgxMcpAccess(){
 const request=async(path:string,input?:unknown)=>{const response=await fetch('/__ngx_access/'+path,{method:input===undefined?'GET':'POST',credentials:'same-origin',headers:input===undefined?undefined:{'content-type':'application/json'},body:input===undefined?undefined:JSON.stringify(input)});if(!response.ok)throw new Error('Trusted access service refused the request');return response.json();};
 const session=await request('session');
 return {session,validateSession:async()=>{try{return await request('session');}catch{return null;}},authorize:async(input:any)=>{try{return(await request('authorize',{operation:input.operation,sourceId:input.sourceId})).allowed===true;}catch{return false;}},approve:async(challenge:any)=>{try{return(await request('approval',challenge)).approved===true;}catch{return false;}},audit:async(event:any)=>{await request('audit',event);},origin:()=>location.origin,route:()=>location.pathname};
}
`;

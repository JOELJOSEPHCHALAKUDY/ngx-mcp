import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
import {settle} from './fixtures.mjs';

export function originalDisabledRefusal(kind,descriptor,result,target){
 if(descriptor?.disabled!==true||result?.error!==true)return false;const value=result.data;
 if(value)return value.status==='not-dispatched'&&value.operation==='activate'&&value.target?.instanceId===target.instanceId&&Array.isArray(value.changed)&&value.changed.length===0;
 return kind==='native'&&result.text==='The exact current target does not support this available UI operation';
}
export function originalInvalidRefusal(result,target){const value=result?.data;return result?.error===true&&value?.status==='not-dispatched'&&value.operation==='submit'&&value.target?.instanceId===target.instanceId&&value.validation?.status==='invalid'&&Array.isArray(value.changed)&&value.changed.length===0;}

export async function transportDriver(page,origin,kind,root,session,calls){
 let client,server,gateway,httpTransport;
 if(kind==='mcp'){
  const require=createRequire(resolve(root,'package.json'));
  const {Client}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
  const {StreamableHTTPClientTransport}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js')).href);
  const {createIntegrationMcpServer}=await import(pathToFileURL(resolve(root,'src/integration-mcp.ts')).href);
  const {createHostedMcpServer,createJwtAccessVerifier}=await import(pathToFileURL(resolve(root,'src/integration-hosted.ts')).href);
  const {generateKeyPair,exportJWK,createLocalJWKSet,SignJWT}=await import(pathToFileURL(require.resolve('jose')).href);
  const reservation=createServer();await new Promise((done,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',done);});const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const publicUrl='http://127.0.0.1:'+port+'/mcp',issuer='https://identity.example',subject=session?.subject??'synthetic-owner-a',keyId='fresh-fixture-es256';
  const {privateKey,publicKey}=await generateKeyPair('ES256'),key={...await exportJWK(publicKey),kid:keyId,alg:'ES256'},httpAudit=[];
  const token=await new SignJWT({client_id:'fresh-client',scope:'ngx-mcp:use ngx-mcp:read ngx-mcp:write'}).setProtectedHeader({alg:'ES256',kid:keyId}).setIssuer(issuer).setSubject(subject).setAudience(publicUrl).setIssuedAt().setExpirationTime('10m').sign(privateKey);
  const gatewayEvidence={transport:'authenticated-streamable-http',publicUrl,issuer,subject,algorithm:'ES256',trustedLocalKeyId:keyId,networkScope:'Explicit loopback HTTP fixture; real TLS proxy and external IdP deployment are not exercised.',audit:httpAudit};calls.push(gatewayEvidence);
  gateway=createHostedMcpServer({publicUrl,authorizationServers:[issuer],verifyAccessToken:createJwtAccessVerifier({issuer,audience:publicUrl,keySet:createLocalJWKSet({keys:[key]}),algorithms:['ES256'],requiredScopes:['ngx-mcp:use']}),maxSessions:1,maxSessionsPerPrincipal:1,requestsPerMinute:10000,audit:event=>{httpAudit.push(event);},createSession:async principal=>{
   assert.equal(principal.subject,subject);server=createIntegrationMcpServer(page,origin,{expectedSubject:subject,expectedSessionId:session?.id,requireProduction:true});
   return {server,authorize:async()=>{await page.evaluate(async({subject,id})=>{const api=globalThis.__angularMcpBridge;if(api?.profile!=='production')throw new Error('Expected production application');await api.assertIdentity(subject,id);},{subject,id:session?.id});},close:async()=>{await server.close();}};
  }});
  await gateway.listen(port,'127.0.0.1');client=new Client({name:'production-fresh-frozen-oracle',version:'1'});httpTransport=new StreamableHTTPClientTransport(new URL(publicUrl),{requestInit:{headers:{Authorization:'Bearer '+token}}});
  try{await client.connect(httpTransport);}catch(error){await client.close().catch(()=>{});await gateway.close();gatewayEvidence.connectionRefused=String(error);throw error;}

 }
 const rawCall=async(name,args={})=>{
  let result;
  if(kind==='mcp')result=await client.callTool({name,arguments:args});
  else result=await page.evaluate(async({name,args})=>{
   const context=document.modelContext;if(!context||typeof context.executeTool!=='function')throw new Error('Native document.modelContext.executeTool is unavailable');
   const tools=await context.getTools(),tool=tools.find(tool=>tool.name===name);if(!tool)throw new Error('Native tool not exposed: '+name);
   const value=await context.executeTool(tool,args);return typeof value==='string'?JSON.parse(value):value;
  },{name,args});
  const content=result?.structuredContent??(()=>{try{return JSON.parse(result.content?.filter(item=>item.type==='text').map(item=>item.text).join('\n'));}catch{return undefined;}})();
  // Deliberately retain invocation fields and redacted integration responses in
  // synthetic evaluation evidence. Real application audit is tested separately.
  const entry={transport:kind,name,args,result};calls.push(entry);
  return {error:result?.isError===true,data:content,text:result?.content?.filter(item=>item.type==='text').map(item=>item.text).join('\n')??'',result};
 };
 const call=async(name,args,options={})=>{
  const result=await rawCall(name,args);if(result.error){
   const value=result.data,reason=value?.reason??result.text;
   const nativeInvalid=options.expectInvalid&&originalInvalidRefusal(result,args.target);
   if(!nativeInvalid)throw new Error(name+' refused: '+reason);
  }return result;
 };
 const target=async locator=>{
  assert.equal(await locator.count(),1,'Frozen source locator must identify exactly one live target');
  const value=await locator.evaluate(node=>{const owner=node.closest('[data-angular-mcp-instance]');return owner?{instanceId:owner.getAttribute('data-angular-mcp-instance')}:null;});
  if(!value)throw new Error('Unsupported: source-selected UI has no live compiler identity');
  const metadata=await page.evaluate(target=>globalThis.__angularMcpBridge.inspect(target),value);
  if(metadata.provenance==='runtime-dom')throw new Error('Unsupported: runtime-DOM identity is not owner-reviewed compiler provenance');
  return {...value,sourceId:metadata.sourceId};
 };
 return {call,rawCall,target,
  async fill(locator,value){const selected=await target(locator);await call('angular_fill',{target:selected,value});await settle(page);},
  async activate(locator,options={}){
   const selected=await target(locator);let before;if(options.expectUnavailable){before=(await call('angular_describe_node',{target:selected})).data;assert.equal(before?.disabled,true,'Guarded transport metadata must confirm the source-disabled action before dispatch');}
   const result=await rawCall('angular_activate',{target:selected});
   if(options.expectUnavailable){assert(originalDisabledRefusal(kind,before,result,selected),'Refusal must be the original disabled UI, not a policy, network or identity denial');const after=(await call('angular_describe_node',{target:selected})).data;assert.equal(after?.disabled,true,'The original disabled target must remain disabled after refusal');}
   else if(result.error)throw new Error('angular_activate refused: '+(result.data?.reason??result.text));
   await settle(page);return result;
  },
  async select(locator,value,{label}={}){if((await locator.evaluate(node=>node.tagName))==='MAT-SELECT'){await this.activate(locator);await this.activate(page.getByRole('option',{name:label??String(value),exact:true}));}else await this.fill(locator,String(value));},
  async submit(form,options={}){await call('angular_submit',{target:await target(form),values:[]},options);await settle(page);},
  async close(){if(httpTransport)await httpTransport.terminateSession().catch(()=>{});if(client)await client.close();if(gateway)await gateway.close();else if(server)await server.close();}
 };
}

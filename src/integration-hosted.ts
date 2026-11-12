import {createHash,randomUUID} from 'node:crypto';
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {isInitializeRequest} from '@modelcontextprotocol/sdk/types.js';
import type {Server as McpServer} from '@modelcontextprotocol/sdk/server/index.js';
import type {Browser,BrowserContext,Page} from 'playwright';
import {createIntegrationMcpServer} from './integration-mcp.js';
import {createRemoteJWKSet,jwtVerify,type JWTVerifyGetKey,type JWTPayload} from 'jose';

export interface HostedPrincipal {
  issuer: string;
  subject: string;
  clientId: string;
  scopes: string[];
  expiresAt: number;
  resource: string;
}
export interface HostedAuditEvent {
  at: string;
  event: 'authentication-denied'|'request-denied'|'request-authorized'|'session-opening'|'session-created'|'session-closed';
  principal?: string;
  session?: string;
  reason?: string;
}
export interface HostedMcpSession {
  server: McpServer;
  /** Revalidate the authenticated app account before every MCP HTTP request. */
  authorize(signal?:AbortSignal): Promise<void>;
  /** Close the isolated application browser context and other resources owned by this session. */
  close(signal?:AbortSignal): Promise<void>;
}
export interface HostedMcpOptions {
  publicUrl: string;
  /** HTTPS is terminated by the operator's reverse proxy; forwarding headers are never used as authentication. */
  tlsTerminatedByProxy?: boolean;
  /** Explicit opt-in for container/private-network binding; default listener is loopback only. */
  allowExternalBind?: boolean;
  dispose?(signal?:AbortSignal): void|Promise<void>;
  authorizationServers: string[];
  verifyAccessToken(token: string,signal?:AbortSignal): Promise<HostedPrincipal>;
  /** Trusted server code provisions a distinct application session for this authenticated identity. */
  createSession(principal: Readonly<HostedPrincipal>,signal?:AbortSignal): Promise<HostedMcpSession>;
  audit(event: Readonly<HostedAuditEvent>,signal?:AbortSignal): void|Promise<void>;
  allowedOrigins?: string[];
  allowedHosts?: string[];
  requiredScopes?: string[];
  /** Exact additional tool names and their required token scopes. Unknown tools are denied. */
  toolScopes?: Record<string,string[]>;
  maxSessions?: number;
  maxSessionsPerPrincipal?: number;
  maxConcurrentRequestsPerSession?: number;
  maxPendingAuthentications?: number;
  idleTimeoutMs?: number;
  sessionLifetimeMs?: number;
  maxRequestBytes?: number;
  requestsPerMinute?: number;
  callbackTimeoutMs?: number;
  sessionCreationTimeoutMs?: number;
}
export interface JwtAccessVerifierOptions {
  issuer: string;
  audience: string;
  jwksUrl?: string;
  /** Server-owned resolver, for locally pinned keys or an existing trusted identity integration. */
  keySet?: JWTVerifyGetKey;
  requiredScopes?: string[];
  algorithms?: ('RS256'|'PS256'|'ES256'|'EdDSA')[];
  isRevoked?(claims: Readonly<JWTPayload>): boolean|Promise<boolean>;
}

const loopback=(host:string)=>['127.0.0.1','localhost','[::1]'].includes(host);
function absoluteHttp(value:string,allowLocal=true):URL {
  const url=new URL(value);
  if(url.username||url.password||url.hash||!(url.protocol==='https:'||allowLocal&&url.protocol==='http:'&&loopback(url.hostname)))throw new Error('Use HTTPS, or HTTP on an explicitly configured loopback host.');
  return url;
}
function exactOrigin(value:string):string {
  const url=absoluteHttp(value);if(url.pathname!=='/'||url.search)throw new Error('Allowed origins must contain an origin only.');return url.origin;
}
function bounded(value:number|undefined,fallback:number,maximum:number,label:string){
  const result=value??fallback;if(!Number.isSafeInteger(result)||result<1||result>maximum)throw new Error('Invalid '+label);return result;
}
function principalKey(principal:HostedPrincipal){return JSON.stringify([principal.issuer,principal.subject,principal.clientId]);}
function scopeKey(principal:HostedPrincipal){return JSON.stringify(Array.from(new Set(principal.scopes)).sort());}
const fingerprint=(value:string)=>createHash('sha256').update(value).digest('hex');

/** No access-token cache: signature/expiry/revocation and scopes are checked on every request. */
export function createJwtAccessVerifier(options:JwtAccessVerifierOptions):(token:string)=>Promise<HostedPrincipal> {
  const issuer=absoluteHttp(options.issuer,false);
  if(issuer.search)throw new Error('The issuer must be an exact HTTPS issuer identifier without query parameters.');
  if(typeof options.audience!=='string'||!options.audience)throw new Error('A token audience is required.');
  if(Boolean(options.jwksUrl)===Boolean(options.keySet))throw new Error('Configure exactly one trusted JWKS URL or key resolver.');
  const resolver=options.keySet??createRemoteJWKSet(absoluteHttp(options.jwksUrl!,false),{cacheMaxAge:300000,cooldownDuration:30000,timeoutDuration:5000});
  const algorithms=options.algorithms??['RS256','PS256','ES256','EdDSA'];
  const allowed=new Set(['RS256','PS256','ES256','EdDSA']);
  if(!algorithms.length||algorithms.some(value=>!allowed.has(value)))throw new Error('Only configured asymmetric JWT signature algorithms are supported.');
  return async token=>{
    if(typeof token!=='string'||!token||token.length>16384)throw new Error('Invalid access token');
    const {payload}=await jwtVerify(token,resolver,{issuer:options.issuer,audience:options.audience,algorithms,requiredClaims:['iss','sub','exp'],clockTolerance:0});
    const clientId=payload['client_id']??payload['azp'];
    if(typeof payload.sub!=='string'||!payload.sub||typeof clientId!=='string'||!clientId||typeof payload.exp!=='number'||!Number.isSafeInteger(payload.exp))throw new Error('The token must identify its subject, client and expiry.');
    let scopes:string[];
    if(typeof payload['scope']==='string')scopes=payload['scope'].split(/\s+/).filter(Boolean);
    else if(Array.isArray(payload['scp'])&&payload['scp'].every(scope=>typeof scope==='string'))scopes=payload['scp'];
    else scopes=[];
    if((options.requiredScopes??[]).some(scope=>!scopes.includes(scope)))throw new Error('The access token lacks a required scope.');
    if(options.isRevoked&&await options.isRevoked(payload))throw new Error('The access token was revoked.');
    return {issuer:payload.iss!,subject:payload.sub,clientId,scopes:Array.from(new Set(scopes)).sort(),expiresAt:payload.exp,resource:options.audience};
  };
}

/** Opt-in remote application URLs remain exact-origin HTTPS allowlisted. */
export function validateApplicationUrl(value:string,allowedOrigins:string[]=[]):URL {
  const url=absoluteHttp(value);
  if(!loopback(url.hostname)&&!allowedOrigins.map(exactOrigin).includes(url.origin))throw new Error('Use a local HTTP application origin. Remote apps require an explicitly allowed HTTPS application origin.');
  return url;
}

interface SessionRecord {
  id:string; key:string; scopes:string; principal:HostedPrincipal;
  transport:StreamableHTTPServerTransport; resources:HostedMcpSession;
  created:number; touched:number; activeRequests:number; closed:boolean; closing?:Promise<void>;
}

/** Authenticated MCP HTTP gateway. App authentication remains in a server-owned per-user session factory. */
export function createHostedMcpServer(options:HostedMcpOptions){
  const publicUrl=absoluteHttp(options.publicUrl);
  if(publicUrl.protocol==='https:'&&options.tlsTerminatedByProxy!==true)throw new Error('Configure TLS termination at the HTTPS reverse proxy explicitly.');
  if(publicUrl.search||publicUrl.pathname==='/'||publicUrl.pathname.endsWith('/'))throw new Error('Configure a distinct MCP endpoint path without a query or trailing slash.');
  if(typeof options.verifyAccessToken!=='function'||typeof options.createSession!=='function'||typeof options.audit!=='function')throw new Error('Hosted MCP requires a verifier, isolated session factory and audit sink.');
  if(!Array.isArray(options.authorizationServers)||!options.authorizationServers.length)throw new Error('Configure the trusted authorization servers.');
  const authorizationServers=options.authorizationServers.map(value=>{absoluteHttp(value,false);return value;});
  const allowedOrigins=new Set([publicUrl.origin,...(options.allowedOrigins??[]).map(exactOrigin)]);
  const allowedHosts=new Set([publicUrl.hostname,...(options.allowedHosts??[])]);
  for(const host of allowedHosts)if(!host||/[\s/@?#]/.test(host)||host.includes(':')&&host!=='[::1]')throw new Error('Allowed hosts must be exact hostnames, without ports.');
  const requiredScopes=options.requiredScopes??['ngx-mcp:use'];
  const toolScopes:Record<string,string[]>=options.toolScopes??Object.create(null);
  const validateScopes=(scopes:string[])=>{if(!Array.isArray(scopes)||!scopes.length||scopes.some(scope=>typeof scope!=='string'||!/^[-A-Za-z0-9:._]{1,200}$/.test(scope)))throw new Error('Configure nonempty exact token scope names.');};
  validateScopes(requiredScopes);
  for(const scopes of Object.values(toolScopes))validateScopes(scopes);
  const scopesForTool=(name:string):string[]|undefined=>{
    if(Object.hasOwn(toolScopes,name))return toolScopes[name];
    if(['angular_list_nodes','angular_describe_node','angular_read_model','angular_read_view'].includes(name))return ['ngx-mcp:read'];
    if(['angular_fill','angular_activate','angular_submit','angular_drag','angular_press_key','angular_upload_file','angular_navigate'].includes(name)||/^angular_form_[a-f0-9]{16}$/.test(name))return ['ngx-mcp:write'];
    return undefined;
  };
  const toolAllowed=(name:string,principal:HostedPrincipal)=>{const needed=scopesForTool(name);return !!needed&&needed.every(scope=>principal.scopes.includes(scope));};
  const discoveryScopes=Array.from(new Set([...requiredScopes,'ngx-mcp:read']));
  const challengedScopes=(message:any):string[]=>{if(Array.isArray(message))return Array.from(new Set(message.flatMap(challengedScopes)));return message?.method==='tools/call'&&typeof message.params?.name==='string'?scopesForTool(message.params.name)??[]:message?.method==='tools/list'?['ngx-mcp:read']:[];};
  const messageAllowed=(value:any,principal:HostedPrincipal):boolean=>{
    if(Array.isArray(value))return value.length>0&&value.every(item=>messageAllowed(item,principal));
    if(!value||typeof value!=='object'||typeof value.method!=='string')return false;
    if(['initialize','notifications/initialized','notifications/cancelled','ping'].includes(value.method))return true;
    if(value.method==='tools/list')return principal.scopes.includes('ngx-mcp:read');
    if(value.method==='tools/call')return typeof value.params?.name==='string'&&toolAllowed(value.params.name,principal);
    return false;
  };
  const maxSessions=bounded(options.maxSessions,32,10000,'session limit');
  const perPrincipal=bounded(options.maxSessionsPerPrincipal,2,maxSessions,'per-principal session limit');
  const concurrentRequests=bounded(options.maxConcurrentRequestsPerSession,8,100,'concurrent request limit');
  const maxAuth=bounded(options.maxPendingAuthentications,16,1000,'authentication concurrency limit');
  const idle=bounded(options.idleTimeoutMs,300000,86400000,'idle timeout');
  const lifetime=bounded(options.sessionLifetimeMs,3600000,86400000,'session lifetime');
  const maxBytes=bounded(options.maxRequestBytes,1048576,16777216,'request body limit');
  const rateLimit=bounded(options.requestsPerMinute,120,100000,'request rate limit');
  const callbackTimeout=bounded(options.callbackTimeoutMs,10000,300000,'callback timeout');
  const creationTimeout=bounded(options.sessionCreationTimeoutMs,30000,300000,'session creation timeout');
  const metadataPath='/.well-known/oauth-protected-resource'+publicUrl.pathname;
  const metadataUrl=new URL(metadataPath,publicUrl.origin).href;
  const records=new Map<string,SessionRecord>(),revoked=new Set<string>(),pending=new Map<string,number>(),rates=new Map<string,{until:number;count:number}>();
  let stopping=false,pendingAuth=0,pendingSessions=0,closing:Promise<void>|undefined;
  const callbacks=new Set<Promise<unknown>>(),controllers=new Set<AbortController>(),cleanupControllers=new Set<AbortController>();
  const callbackLimit=maxAuth+maxSessions*(concurrentRequests+2)+16;
  const invoke=async<T>(run:(signal:AbortSignal)=>T|Promise<T>,timeout=callbackTimeout,lateCleanup?:(value:T)=>void|Promise<void>,onSettled?:(succeeded:boolean)=>void,cleanup=false):Promise<T>=>{
    if(!cleanup&&callbacks.size>=callbackLimit){onSettled?.(false);throw new Error('callback_busy');}
    const controller=new AbortController();controllers.add(controller);if(cleanup)cleanupControllers.add(controller);
    let succeeded=false;
    const task=Promise.resolve().then(()=>run(controller.signal)).then(async value=>{succeeded=true;if(controller.signal.aborted){await lateCleanup?.(value);throw new Error('callback_timeout');}return value;});
    callbacks.add(task);
    const settled=()=>{callbacks.delete(task);controllers.delete(controller);cleanupControllers.delete(controller);onSettled?.(succeeded);};void task.then(settled,settled);
    let timer:ReturnType<typeof setTimeout>|undefined,abort:()=>void=()=>{};
    try{return await Promise.race([task,new Promise<never>((resolve,reject)=>{void resolve;abort=()=>reject(new Error('callback_timeout'));controller.signal.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>controller.abort(),timeout);})]);}
    finally{if(timer)clearTimeout(timer);controller.signal.removeEventListener('abort',abort);}
  };

  const audit=async(event:HostedAuditEvent['event'],principal?:HostedPrincipal,id?:string,reason?:string)=>{
    const data:HostedAuditEvent={at:new Date().toISOString(),event,...principal?{principal:fingerprint(principalKey(principal))}:{},...id?{session:fingerprint(id)}:{},...reason?{reason}:{}};
    await invoke(signal=>options.audit(Object.freeze(data),signal));
  };
  const answer=(response:ServerResponse,status:number,message:string)=>{
    response.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});response.end(JSON.stringify({error:message}));
  };
  const authenticate=async(request:IncomingMessage,signal:AbortSignal):Promise<HostedPrincipal>=>{
    const authorization=request.headers.authorization;
    if(typeof authorization!=='string'||!/^Bearer [A-Za-z0-9\-._~+/]+=*$/.test(authorization)||authorization.length>16391)throw new Error('invalid_token');
    const principal=await options.verifyAccessToken(authorization.slice(7),signal);
    if(!principal||typeof principal.issuer!=='string'||!principal.issuer||typeof principal.subject!=='string'||!principal.subject||typeof principal.clientId!=='string'||!principal.clientId||!Array.isArray(principal.scopes)||principal.scopes.some(scope=>typeof scope!=='string')||!Number.isSafeInteger(principal.expiresAt)||principal.expiresAt<=Date.now()/1000||principal.resource!==publicUrl.href||!authorizationServers.includes(principal.issuer))throw new Error('invalid_token');
    if(revoked.has(principalKey(principal)))throw new Error('invalid_token');
    if(requiredScopes.some(scope=>!principal.scopes.includes(scope)))throw new Error('insufficient_scope');
    return Object.freeze({...principal,scopes:Object.freeze([...principal.scopes])}) as unknown as HostedPrincipal;
  };
  const destroy=(record:SessionRecord,reason:string):Promise<void>=>{
    if(record.closing)return record.closing;
    record.closed=true;
    const closingTask=invoke(async signal=>{const results=await Promise.allSettled([record.transport.close(),record.resources.close(signal)]);if(results.some(result=>result.status==='rejected'))throw new Error('session_cleanup_failed');},callbackTimeout,undefined,succeeded=>{if(succeeded)records.delete(record.id);},true);
    record.closing=closingTask.then(()=>audit('session-closed',record.principal,record.id,reason),async error=>{await audit('request-denied',record.principal,record.id,'session_cleanup_failed');throw error;});
    return record.closing;
  };
  const expired=(record:SessionRecord,now=Date.now())=>now-record.touched>=idle||now-record.created>=lifetime||record.principal.expiresAt*1000<=now;
  const sweep=async()=>{
    const now=Date.now();await Promise.allSettled(Array.from(records.values()).filter(record=>expired(record,now)).map(record=>destroy(record,'expired')));
    for(const [key,rate]of rates)if(rate.until<=now)rates.delete(key);
  };
  const body=async(request:IncomingMessage)=>{
    if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']??''))throw new Error('unsupported_media_type');
    const declared=request.headers['content-length'];if(declared&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes))throw new Error('request_too_large');
    const chunks:Buffer[]=[];let total=0;
    for await(const value of request){const chunk=Buffer.isBuffer(value)?value:Buffer.from(value);total+=chunk.length;if(total>maxBytes)throw new Error('request_too_large');chunks.push(chunk);}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('invalid_json');}
  };
  const httpServer=createServer({maxHeaderSize:32768},async(request,response)=>{
    response.setHeader('cache-control','no-store');response.setHeader('x-content-type-options','nosniff');
    try{
      if(stopping){answer(response,503,'server_stopping');return;}
      const rawHost=request.headers.host;
      let hostname='';try{if(typeof rawHost==='string'){const candidate=new URL('http://'+rawHost);if(!candidate.username&&!candidate.password&&candidate.pathname==='/'&&!candidate.search&&!candidate.hash)hostname=candidate.hostname;}}catch{}
      if(!hostname||!allowedHosts.has(hostname)){await audit('request-denied',undefined,undefined,'invalid_host');answer(response,403,'invalid_host');return;}
      const origin=request.headers.origin;
      if(origin!==undefined&&(typeof origin!=='string'||!allowedOrigins.has(origin))){await audit('request-denied',undefined,undefined,'invalid_origin');answer(response,403,'invalid_origin');return;}
      if(typeof origin==='string'){
        response.setHeader('access-control-allow-origin',origin);response.setHeader('vary','Origin');
        response.setHeader('access-control-expose-headers','Mcp-Session-Id,WWW-Authenticate');
      }
      const path=new URL(request.url??'/',publicUrl.origin).pathname;
      if((path===metadataPath||path==='/.well-known/oauth-protected-resource')&&request.method==='GET'){
        response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({resource:publicUrl.href,authorization_servers:authorizationServers,scopes_supported:discoveryScopes,bearer_methods_supported:['header']}));return;
      }
      if(path!==publicUrl.pathname){answer(response,404,'not_found');return;}
      if(request.method==='OPTIONS'){
        response.setHeader('access-control-allow-methods','POST,GET,DELETE,OPTIONS');
        response.setHeader('access-control-allow-headers','Authorization,Content-Type,Mcp-Session-Id,MCP-Protocol-Version,Last-Event-ID');
        response.writeHead(204);response.end();return;
      }
      if(!['POST','GET','DELETE'].includes(request.method??'')){answer(response,405,'method_not_allowed');return;}
      if(pendingAuth>=maxAuth){answer(response,429,'authentication_busy');return;}
      let principal:HostedPrincipal;
      pendingAuth++;
      try{principal=await invoke(signal=>authenticate(request,signal),callbackTimeout,undefined,()=>{pendingAuth--;});}catch(error){
        if(error instanceof Error&&['callback_timeout','callback_busy'].includes(error.message)){answer(response,503,'authentication_unavailable');return;}
        const reason=error instanceof Error&&error.message==='insufficient_scope'?'insufficient_scope':'invalid_token';
        await audit('authentication-denied',undefined,undefined,reason);
        response.setHeader('WWW-Authenticate','Bearer resource_metadata="'+metadataUrl+'", error="'+reason+'", scope="'+discoveryScopes.join(' ')+'"');
        answer(response,reason==='insufficient_scope'?403:401,reason);return;
      }
      const key=principalKey(principal),now=Date.now();
      const rate=rates.get(key);
      if(rate&&rate.until>now){if(++rate.count>rateLimit){answer(response,429,'rate_limit');return;}}
      else{if(rates.size>=maxSessions*10){answer(response,429,'principal_limit');return;}rates.set(key,{until:now+60000,count:1});}
      await sweep();
      const rawId=request.headers['mcp-session-id'];
      if(Array.isArray(rawId)||typeof rawId==='string'&&(rawId.length>128||!/^[A-Za-z0-9_-]+$/.test(rawId))){answer(response,404,'unknown_session');return;}
      let record=typeof rawId==='string'?records.get(rawId):undefined;
      let parsed:unknown;
      if(rawId){
        if(!record||record.closed||record.key!==key||record.scopes!==scopeKey(principal)||expired(record)){await audit('request-denied',principal,undefined,'unknown_session');answer(response,404,'unknown_session');return;}
      }else{
        if(request.method!=='POST'){answer(response,400,'session_required');return;}
        parsed=await body(request);
        if(!isInitializeRequest(parsed)){answer(response,400,'initialize_required');return;}
        const count=Array.from(records.values()).filter(item=>item.key===key&&!item.closed).length+(pending.get(key)??0);
        if(records.size+pendingSessions>=maxSessions||count>=perPrincipal){answer(response,429,'session_limit');return;}
        pendingSessions++;pending.set(key,(pending.get(key)??0)+1);
        let resources:HostedMcpSession|undefined,factoryStarted=false,factorySettled=false,branchDone=false;
        const releaseReservation=()=>{if(!branchDone||factoryStarted&&!factorySettled)return;pendingSessions--;const value=(pending.get(key)??1)-1;if(value)pending.set(key,value);else pending.delete(key);};
        try{
          await audit('session-opening',principal);
          factoryStarted=true;
          resources=await invoke(signal=>options.createSession(principal,signal),creationTimeout,async late=>{if(late?.close)await late.close();},()=>{factorySettled=true;releaseReservation();});
          if(!resources||!resources.server||typeof resources.close!=='function'||typeof resources.authorize!=='function')throw new Error('invalid_session_factory');
          if(stopping||revoked.has(key)||principal.expiresAt<=Date.now()/1000)throw new Error('session_not_authorized');
          const id=randomUUID().replaceAll('-','');
          const transport=new StreamableHTTPServerTransport({sessionIdGenerator:()=>id,enableJsonResponse:true,maxRequestBodySize:maxBytes});
          const send=transport.send.bind(transport);
          transport.send=async(message,sendOptions)=>{
            if('result' in message&&message.result&&Array.isArray(message.result['tools'])){
              message={...message,result:{...message.result,tools:message.result['tools'].filter((tool:any)=>typeof tool?.name==='string'&&toolAllowed(tool.name,principal))}};
            }
            await send(message,sendOptions);
          };
          record={id,key,scopes:scopeKey(principal),principal,transport,resources,created:Date.now(),touched:Date.now(),activeRequests:0,closed:false};
          const session=record;
          transport.onclose=()=>{void destroy(session,'transport_closed').catch(()=>{});};
          await resources.server.connect(transport);records.set(id,record);
          await audit('session-created',principal,id);
        }catch(error){if(record)await destroy(record,'initialization_failed');else if(resources)await invoke(signal=>resources!.close(signal),callbackTimeout,undefined,undefined,true);throw error;}
        finally{branchDone=true;releaseReservation();}
      }
      if(!record){answer(response,404,'unknown_session');return;}
      if(record.activeRequests>=concurrentRequests){answer(response,429,'session_busy');return;}
      const session=record;session.activeRequests++;
      try{
        if(request.method==='POST'&&parsed===undefined)parsed=await body(request);
        if(request.method==='POST'&&!messageAllowed(parsed,principal)){
          await audit('request-denied',principal,session.id,'tool_scope_denied');
          response.setHeader('WWW-Authenticate','Bearer resource_metadata="'+metadataUrl+'", error="insufficient_scope", scope="'+Array.from(new Set([...discoveryScopes,...challengedScopes(parsed)])).join(' ')+'"');
          answer(response,403,'tool_scope_denied');return;
        }
        try{await invoke(signal=>session.resources.authorize(signal));}catch{await destroy(session,'app_session_denied');answer(response,403,'app_session_denied');return;}
        await audit('request-authorized',principal,session.id);
        if(session.closed||revoked.has(key)||expired(session)){answer(response,401,'invalid_token');return;}
        session.touched=Date.now();
        (request as any).auth={token:request.headers.authorization!.slice(7),clientId:principal.clientId,scopes:[...principal.scopes],expiresAt:principal.expiresAt,resource:publicUrl,extra:{issuer:principal.issuer,subject:principal.subject}};
        await session.transport.handleRequest(request,response,parsed);
      }finally{session.activeRequests--;if(request.method==='DELETE')await destroy(session,'client_closed');else if(!session.transport.sessionId)await destroy(session,'initialize_failed');}
    }catch(error){
      if(response.destroyed)return;
      if(response.headersSent){response.end();return;}
      const reason=error instanceof Error?error.message:'';
      answer(response,reason==='request_too_large'?413:reason==='unsupported_media_type'?415:reason==='invalid_json'?400:503,['request_too_large','unsupported_media_type','invalid_json'].includes(reason)?reason:'service_unavailable');
    }
  });
  httpServer.maxConnections=maxSessions*concurrentRequests+maxAuth+16;
  httpServer.headersTimeout=10000;httpServer.requestTimeout=30000;httpServer.keepAliveTimeout=5000;
  const timer=setInterval(()=>{void sweep().catch(()=>{});},Math.min(idle,30000));timer.unref();
  return {
    httpServer,
    get sessionCount(){return records.size;},
    async listen(port=3000,host='127.0.0.1'){
      if(!Number.isSafeInteger(port)||port<0||port>65535)throw new Error('Invalid listen port');
      if(!loopback(host)&&host!=='::1'&&!(options.allowExternalBind===true&&options.tlsTerminatedByProxy===true&&publicUrl.protocol==='https:'))throw new Error('External binding requires explicit private-network binding and HTTPS proxy configuration.');
      await new Promise<void>((done,reject)=>{httpServer.once('error',reject);httpServer.listen(port,host,()=>{httpServer.removeListener('error',reject);done();});});
      return httpServer.address();
    },
    async revokePrincipal(principal:Pick<HostedPrincipal,'issuer'|'subject'|'clientId'>){
      const key=principalKey(principal as HostedPrincipal);revoked.add(key);await Promise.all(Array.from(records.values()).filter(record=>record.key===key).map(record=>destroy(record,'principal_revoked')));
    },
    async closeSession(id:string){const record=records.get(id);if(record)await destroy(record,'owner_closed');},
    close(){
      if(closing)return closing;
      closing=(async()=>{stopping=true;clearInterval(timer);for(const controller of controllers)if(!cleanupControllers.has(controller))controller.abort();try{
        await Promise.allSettled(Array.from(records.values()).map(record=>destroy(record,'server_closed')));
        httpServer.closeIdleConnections();httpServer.closeAllConnections();if(httpServer.listening)await new Promise<void>(done=>httpServer.close(()=>done()));
      }finally{if(options.dispose)await invoke(signal=>options.dispose!(signal),callbackTimeout,undefined,undefined,true);}})();
      return closing;
    }
  };
}

export interface HostedBrowserSessionOptions {
  browser: Browser;
  baseUrl: string;
  allowedAppOrigins?: string[];
  /** Exact resource, API and identity-provider origins approved by the application operator. */
  allowedNetworkOrigins?: string[];
  initialize(context: BrowserContext,page: Page,principal: Readonly<HostedPrincipal>,signal?:AbortSignal): Promise<void>;
  /** Check the app's actual authenticated account/tenant against the MCP identity before exposing tools. */
  verifyApplicationIdentity(page: Page,principal: Readonly<HostedPrincipal>,signal?:AbortSignal): Promise<boolean>;
  createMcpServer?(page: Page,baseUrl: string,principal: Readonly<HostedPrincipal>,binding: Readonly<{subject:string;sessionId:string}>): McpServer|Promise<McpServer>;
  /** Optional trusted mapping when application subject IDs differ from MCP identity subject IDs. */
  expectedSubject?(principal: Readonly<HostedPrincipal>): string;
}

/** Each authenticated MCP session gets a fresh browser context; no client-selected URL or shared storage state. */
export function createBrowserSessionFactory(options:HostedBrowserSessionOptions):(principal:Readonly<HostedPrincipal>,signal?:AbortSignal)=>Promise<HostedMcpSession> {
  const baseUrl=validateApplicationUrl(options.baseUrl,options.allowedAppOrigins),origin=baseUrl.origin;
  const allowed=new Set([origin,...(options.allowedNetworkOrigins??[]).map(exactOrigin)]);
  if(typeof options.initialize!=='function'||typeof options.verifyApplicationIdentity!=='function')throw new Error('Provide trusted application sign-in, identity verification and MCP-server callbacks.');
  return async(principal,signal)=>{
    signal?.throwIfAborted();
    const context=await options.browser.newContext({acceptDownloads:false,serviceWorkers:'block'});
    let server:McpServer|undefined;
    const abort=()=>{void context.close().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
    try{
      await context.route('**/*',async route=>{let approved=false;try{approved=allowed.has(new URL(route.request().url()).origin);}catch{}if(approved)await route.continue();else await route.abort('blockedbyclient');});
      await context.routeWebSocket('**/*',socket=>{const url=new URL(socket.url());url.protocol=url.protocol==='wss:'?'https:':'http:';if(allowed.has(url.origin))socket.connectToServer();else socket.close();});
      const page=await context.newPage();
      await options.initialize(context,page,principal,signal);signal?.throwIfAborted();
      if(page.url()==='about:blank')await page.goto(baseUrl.href);
      if(new URL(page.url()).origin!==origin)throw new Error('Application sign-in did not return to the configured app origin.');
      await page.waitForFunction(()=>!!(globalThis as any).__angularMcpBridge,undefined,{timeout:15000});
      const subject=options.expectedSubject?options.expectedSubject(principal):principal.subject;
      if(typeof subject!=='string'||!subject)throw new Error('An exact authenticated application subject is required.');
      let expectedSessionId:string|undefined;
      const authorize=async(requestSignal?:AbortSignal)=>{
        requestSignal?.throwIfAborted();
        if(new URL(page.url()).origin!==origin)throw new Error('The app session left its configured origin.');
        const status=await page.evaluate(async({expectedSubject,expectedSessionId})=>{
          const api=(globalThis as any).__angularMcpBridge;
          if(api?.profile!=='production'||typeof api.assertIdentity!=='function'||typeof api.accessStatus!=='function')throw new Error('Hosted access requires a production access-controlled application build.');
          await api.assertIdentity(expectedSubject,expectedSessionId);
          const status=api.accessStatus();
          if(!status.ready||status.subject!==expectedSubject||typeof status.sessionId!=='string'||!status.sessionId)throw new Error('The production application session is not ready for this identity.');
          return {subject:status.subject,sessionId:status.sessionId};
        },{expectedSubject:subject,expectedSessionId});
        if(expectedSessionId===undefined)expectedSessionId=status.sessionId;
        if(!await options.verifyApplicationIdentity(page,principal,requestSignal))throw new Error('The app session does not belong to the authenticated MCP identity.');
      };
      await authorize(signal);signal?.throwIfAborted();
      const binding=Object.freeze({subject,sessionId:expectedSessionId!});
      server=options.createMcpServer?await options.createMcpServer(page,baseUrl.href,principal,binding):createIntegrationMcpServer(page,baseUrl.href,{expectedSubject:subject,expectedSessionId,requireProduction:true});
      const owned=server;
      signal?.removeEventListener('abort',abort);
      return {server:owned,authorize,close:async()=>{try{await owned.close();}finally{await context.close();}}};
    }catch(error){signal?.removeEventListener('abort',abort);try{if(server)await server.close();}finally{await context.close();}throw error;}
  };
}

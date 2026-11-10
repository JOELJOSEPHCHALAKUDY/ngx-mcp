#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {chromium} from 'playwright';
import {createIntegrationMcpServer} from './integration-mcp.js';
import {validateApplicationUrl} from './integration-hosted.js';

const {values}=parseArgs({options:{'base-url':{type:'string'},'storage-state':{type:'string'},'allow-origin':{type:'string',multiple:true},'allow-network-origin':{type:'string',multiple:true},headed:{type:'boolean',default:false},help:{type:'boolean',short:'h'}}});
if(values.help){
  console.log('ngx-mcp serve --base-url http://localhost:4200 [--storage-state session.json] [--headed] [--allow-origin https://app.example] [--allow-network-origin https://api.example]\nConnect MCP to an application built by ngx-mcp generate. Live node identity and validation come from its generated Angular runtime registry.');
}else{
  if(!values['base-url'])throw new Error('Provide --base-url for the instrumented application.');
  const url=validateApplicationUrl(values['base-url'],values['allow-origin']??[]);
  const remote=!['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  const browser=await chromium.launch({headless:!values.headed});
  try{
    const context=await browser.newContext({storageState:values['storage-state'],serviceWorkers:'block'});
    if(remote){
      const allowed=new Set([url.origin,...(values['allow-network-origin']??[]).map(value=>{const resource=new URL(value);if(resource.protocol!=='https:'||resource.username||resource.password||resource.pathname!=='/'||resource.search||resource.hash)throw new Error('Network origins must be exact HTTPS origins.');return resource.origin;})]);
      await context.route('**/*',async route=>{if(allowed.has(new URL(route.request().url()).origin))await route.continue();else await route.abort('blockedbyclient');});
      await context.routeWebSocket('**/*',socket=>{const resource=new URL(socket.url());resource.protocol=resource.protocol==='wss:'?'https:':'http:';if(allowed.has(resource.origin))socket.connectToServer();else socket.close();});
    }
    const page=await context.newPage();
    await page.goto(url.href);await page.waitForFunction(()=>!!(globalThis as any).__angularMcpBridge,{},{timeout:15000});
    const production=await page.evaluate(()=>(globalThis as any).__angularMcpBridge?.profile==='production');
    if(remote&&!production)throw new Error('Remote application access requires a production access-controlled build.');
    let identity:{subject?:string;sessionId?:string}={};
    if(production){
      await page.waitForFunction(()=>{const status=(globalThis as any).__angularMcpBridge?.accessStatus?.();return !!status?.ready;},undefined,{timeout:values.headed?120000:15000});
      identity=await page.evaluate(async()=>{
        const api=(globalThis as any).__angularMcpBridge;await api.assertIdentity();const status=api.accessStatus();
        if(!status.ready||typeof status.subject!=='string'||typeof status.sessionId!=='string')throw new Error('A verified app identity is required before MCP connects.');
        return {subject:status.subject,sessionId:status.sessionId};
      });
    }
    const mode=await page.evaluate(()=>(globalThis as any).__angularMcpBridge?.mode);
    if(mode==='webmcp')throw new Error('This application enables WebMCP only. Generate with --mode mcp or --mode both to use the Node adapter.');
    const server=createIntegrationMcpServer(page,url.href,{expectedSubject:identity.subject,expectedSessionId:identity.sessionId,requireProduction:production||remote});await server.connect(new StdioServerTransport());
    console.error('Compiler-integrated Angular MCP runtime ready.');
    const close=async()=>{await server.close();await browser.close();};process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());process.stdin.once('end',()=>void close());
  }catch(error){await browser.close();throw error;}
}

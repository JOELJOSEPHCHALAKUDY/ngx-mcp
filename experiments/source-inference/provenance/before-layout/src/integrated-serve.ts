#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {chromium} from 'playwright';
import {createIntegrationMcpServer} from './integration-mcp.js';

const {values}=parseArgs({options:{'base-url':{type:'string'},'storage-state':{type:'string'},headed:{type:'boolean',default:false},help:{type:'boolean',short:'h'}}});
if(values.help){
  console.log('angular-mcp-integrated-browser --base-url http://localhost:4200 [--storage-state session.json] [--headed]\nConnect MCP to an application built by angular-mcp-integrate. Live node identity and validation come from its generated Angular runtime registry.');
}else{
  if(!values['base-url'])throw new Error('Provide --base-url for the instrumented application.');
  const url=new URL(values['base-url']);
  if(!['http:','https:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Use a local HTTP application origin.');
  const browser=await chromium.launch({headless:!values.headed});
  try{
    const context=await browser.newContext({storageState:values['storage-state']});const page=await context.newPage();
    await page.goto(url.href);await page.waitForFunction(()=>!!(globalThis as any).__angularMcpBridge,{},{timeout:15000});
    const server=createIntegrationMcpServer(page,url.href);await server.connect(new StdioServerTransport());
    console.error('Compiler-integrated Angular MCP runtime ready.');
    const close=async()=>{await server.close();await browser.close();};process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());process.stdin.once('end',()=>void close());
  }catch(error){await browser.close();throw error;}
}

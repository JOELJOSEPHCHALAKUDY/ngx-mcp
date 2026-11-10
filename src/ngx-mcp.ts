#!/usr/bin/env node
/** One command, two steps: `ngx-mcp generate` builds a copy of the app with its actions registered; `ngx-mcp serve` connects an MCP client to it. */
const [command] = process.argv.splice(2, 1);
if (command === 'generate') await import('./integrate.js');
else if (command === 'serve') await import('./integrated-serve.js');
else if(command==='host'){
  const {parseArgs}=await import('node:util');const {resolve}=await import('node:path');const {pathToFileURL}=await import('node:url');
  const {values}=parseArgs({options:{config:{type:'string'},port:{type:'string',default:'3000'},host:{type:'string',default:'127.0.0.1'},help:{type:'boolean',short:'h'}}});
  if(values.help)console.log('ngx-mcp host --config /absolute/server-config.mjs [--port 3000] [--host 127.0.0.1]\nStart authenticated HTTP MCP with a trusted server configuration exporting verifier, isolated per-user session factory, and audit sink. Configure HTTPS termination at your reverse proxy.');
  else{
    if(!values.config)throw new Error('Provide --config for a trusted server-owned configuration module.');
    if(!/^\d{1,5}$/.test(values.port??'')||Number(values.port)>65535)throw new Error('Provide a valid --port.');
    const configuration=await import(pathToFileURL(resolve(values.config)).href);
    const options=typeof configuration.default==='function'?await configuration.default():configuration.default;
    if(!options||typeof options!=='object')throw new Error('The host configuration must export options or an async options factory as default.');
    const {createHostedMcpServer}=await import('./integration-hosted.js');
    let gateway:ReturnType<typeof createHostedMcpServer>;
    try{gateway=createHostedMcpServer(options);await gateway.listen(Number(values.port),values.host);}catch(error){await options.dispose?.();throw error;}
    console.error('Authenticated ngx-mcp HTTP gateway ready at '+options.publicUrl);
    const close=()=>{void gateway.close().catch(()=>{process.exitCode=1;});};
    process.once('SIGINT',close);process.once('SIGTERM',close);
  }
}
else {
  console.log('ngx-mcp generate --project <tsconfig.app.json> [--mode mcp|webmcp|both] [--out <new directory>] ...   build a copy of the app with its actions registered\n' +
    'ngx-mcp serve --base-url <local-dev-url> [--storage-state <file>] [--headed]      serve that running copy\'s actions over MCP stdio\n' +
    'ngx-mcp host --config <trusted server module> [--port 3000]                 host authenticated HTTP MCP\n' +
    'Add --help after a command for its options.');
  if (command && command !== 'help' && command !== '--help' && command !== '-h') { console.error(`Unknown command: ${command}`); process.exitCode = 1; }
}

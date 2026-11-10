import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {rmSync,chmodSync} from 'node:fs';

rmSync('dist',{recursive:true,force:true});
await build({entryPoints:['src/index.ts','src/integrate.ts','src/integrated-serve.ts','src/ngx-mcp.ts'],outdir:'dist',bundle:true,splitting:true,format:'esm',platform:'node',target:'node22',packages:'external',sourcemap:false});
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','-p','tsconfig.package.json'],{stdio:'inherit'});
for(const entry of ['ngx-mcp','integrate','integrated-serve'])chmodSync('dist/'+entry+'.js',0o755);

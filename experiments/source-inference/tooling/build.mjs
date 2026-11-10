import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {rmSync,chmodSync} from 'node:fs';
rmSync('dist',{recursive:true,force:true});
await build({entryPoints:['src/index.ts','src/cli.ts','src/serve.ts','src/certify.ts','src/browser-runtime.ts'],outdir:'dist',bundle:true,splitting:true,format:'esm',platform:'node',target:'node22',packages:'external',sourcemap:false});
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','-p','tsconfig.package.json'],{stdio:'inherit'});
for(const file of ['dist/cli.js','dist/serve.js','dist/certify.js'])chmodSync(file,0o755);

import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {rmSync,chmodSync} from 'node:fs';
rmSync('dist',{recursive:true,force:true});
await build({entryPoints:['src/index.ts','src/cli.ts','src/serve.ts','src/certify.ts','src/browser-runtime.ts','src/integrate.ts','src/integrated-serve.ts'],outdir:'dist',bundle:true,splitting:true,format:'esm',platform:'node',target:'node22',packages:'external',sourcemap:false});
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','-p','tsconfig.package.json'],{stdio:'inherit'});
chmodSync('dist/cli.js',0o755);chmodSync('dist/serve.js',0o755);chmodSync('dist/certify.js',0o755);

chmodSync('dist/integrate.js',0o755);chmodSync('dist/integrated-serve.js',0o755);

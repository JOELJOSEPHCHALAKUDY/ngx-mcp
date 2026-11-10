import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,mkdtempSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
const npm=process.env.npm_execpath;
if(!npm)throw new Error('Run npm run pack:check');
const [result]=JSON.parse(execFileSync(process.execPath,[npm,'pack','--dry-run','--json','--ignore-scripts'],{encoding:'utf8'}));
const allowed=/^(dist\/|package\.json$|README\.md$|RELEASING\.md$|LICENSE$|THIRD_PARTY_NOTICES\.md$)/;
for(const file of result.files){if(!allowed.test(file.path))throw new Error(`Unexpected package payload: ${file.path}`);if(file.path.startsWith('dist/')&&file.path.endsWith('.js')&&/test-apps|samples\/projects/.test(readFileSync(file.path,'utf8')))throw new Error(`Sample harness leaked into package: ${file.path}`);}
mkdirSync('artifacts',{recursive:true});
const report={name:result.name,version:result.version,compressedBytes:result.size,unpackedBytes:result.unpackedSize,files:result.files.map(f=>f.path),sampleApplicationsIncluded:false,published:false};
writeFileSync('artifacts/package-report.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));

mkdirSync('release',{recursive:true});
const [packed]=JSON.parse(execFileSync(process.execPath,[npm,'pack','--json','--ignore-scripts','--pack-destination','release'],{encoding:'utf8'}));
const temporary=mkdtempSync(join(tmpdir(),'angular-mcp-package-'));
try {
 execFileSync('tar',['-xzf',resolve('release',packed.filename),'-C',temporary]);
 const installed=join(temporary,'package');symlinkSync(resolve('node_modules'),join(installed,'node_modules'),'dir');
 const output=join(temporary,'manifest.json');
 execFileSync(process.execPath,[join(installed,'dist/cli.js'),'--project',resolve('fixtures/orders/tsconfig.json'),'--routes','routes.ts#routes','--out',output,'--generate',join(temporary,'browser')],{cwd:temporary,stdio:'pipe'});
 const manifest=JSON.parse(readFileSync(output,'utf8'));if(!manifest.capabilities.length)throw new Error('Extracted package did not analyze a project');
 execFileSync(process.execPath,[join(installed,'dist/serve.js'),'--help'],{cwd:temporary,stdio:'pipe'});
 execFileSync(process.execPath,[join(installed,'dist/certify.js'),'--help'],{cwd:temporary,stdio:'pipe'});
 execFileSync(process.execPath,[join(installed,'dist/integrate.js'),'--help'],{cwd:temporary,stdio:'pipe'});
 execFileSync(process.execPath,[join(installed,'dist/integrated-serve.js'),'--help'],{cwd:temporary,stdio:'pipe'});
 const app=join(temporary,'consumer-app');mkdirSync(app);symlinkSync(resolve('samples/toolchains/course-crud/node_modules'),join(app,'node_modules'),'dir');
 const appSource=`import {Component} from '@angular/core';import {FormsModule} from '@angular/forms';@Component({selector:'consumer-app',standalone:true,imports:[FormsModule],template:'<form (ngSubmit)="save()"><input name="title" [(ngModel)]="title"><button>Save</button></form>'})export class ConsumerApp{title='';save(){}}`;
 writeFileSync(join(app,'app.ts'),appSource);writeFileSync(join(app,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ES2022',moduleResolution:'bundler',experimentalDecorators:true,skipLibCheck:true,types:[]},files:['app.ts']}));
 const stage=join(temporary,'consumer-integrated');
 execFileSync(process.execPath,[join(installed,'dist/integrate.js'),'--project',join(app,'tsconfig.json'),'--out',stage],{cwd:temporary,stdio:'pipe'});
 const integration=JSON.parse(readFileSync(join(stage,'angular-mcp.integration.json'),'utf8'));
 if(integration.nodes.length!==3||readFileSync(join(app,'app.ts'),'utf8')!==appSource)throw new Error('Extracted integration did not preserve and instrument the consumer application.');
 const result={...report,archive:'release/'+packed.filename,extractedCliSmokePassed:true,extractedIntegrationSmokePassed:true,smokeDependencies:'Uses installed npm dependencies; does not import the compiler source checkout'};
 writeFileSync('artifacts/package-report.json',JSON.stringify(result,null,2)+'\n');console.log('Extracted package CLI and code generation passed.');
} finally {rmSync(temporary,{recursive:true,force:true});}

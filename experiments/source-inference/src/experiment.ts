import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {samples,compileSample,sampleDirectory,sampleApprovals,scenarioCapability} from './samples.js';
import {generate} from './codegen.js';
import {Project} from './project.js';
mkdirSync('artifacts',{recursive:true});
const results=[];
for(const sample of samples){
 const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:sampleDirectory(sample),encoding:'utf8'}).trim();if(sha!==sample.revision)throw new Error(`Unexpected source revision for ${sample.id}`);
 const manifest=compileSample(sample);const directory=`artifacts/samples/${sample.id}`;mkdirSync(directory,{recursive:true});writeFileSync(`${directory}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
 const approvals=sampleApprovals(sample);await generate(manifest,approvals,`${directory}/generated`);
 const project=new Project(resolve(sampleDirectory(sample),sample.tsconfig));const capability=scenarioCapability(sample,manifest);
 results.push({id:sample.id,repository:sample.repository,revision:sha,license:sample.license,complexity:sample.complexity,features:sample.features,typescriptFiles:project.files.length,routes:manifest.routes.length,candidates:manifest.capabilities.length,blocked:manifest.capabilities.filter(c=>c.status==='blocked').length,reviewedTools:approvals.length,scenarioDiscovery:capability?.status??'not-discovered',limitation:sample.scenario.expectedLimitation??null,upstreamLimitation:sample.scenario.upstreamLimitation??null,selectedWorkflow:{component:sample.scenario.component,handler:sample.scenario.handler,kind:sample.scenario.kind??'form'}});
}
writeFileSync('artifacts/public-corpus.json',JSON.stringify({projects:results,limitations:['Five selected scenario outcomes do not measure whole-application precision or recall.','Runtime execution results are in each sample runtime.json; discovery alone is not execution.','No upstream business source is modified.','Native browser-agent WebMCP integration is not established by adapter-contract tests.']},null,2)+'\n');
console.log(JSON.stringify(results,null,2));

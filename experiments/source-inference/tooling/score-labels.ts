import {readFileSync} from 'node:fs';
import {compile} from '../src/compiler.js';
import {schemaScore,representatives} from '../evaluation/metrics.js';
const [,, labelsFile, tsconfig, routes]=process.argv;
const labels=JSON.parse(readFileSync(labelsFile,'utf8'));
// Annotators were not told about additionalProperties; normalise so unknown-property probes are meaningful.
for(const l of labels){if(l.inputSchema&&l.inputSchema.additionalProperties===undefined)l.inputSchema.additionalProperties=false;if(l.inputSchema&&!l.inputSchema.required)l.inputSchema.required=[];}
const m=compile(tsconfig,routes);
const hit=(l:any,c:any)=>l.component===c.component&&l.handler===c.handler&&(l.routes.includes(c.route)||l.routes.length>3);
let found=0,ok=0;const rows:string[]=[];
for(const l of labels){
  const caps=representatives(m.capabilities.filter(c=>hit(l,c)));const p=caps[0];
  if(!p){rows.push(`MISSING  ${l.id} (${l.component}.${l.handler})`);continue;}
  found++;
  let s:any;try{s=schemaScore({...l,project:'x',evidence:[]} as any,p);}catch(e){rows.push(`BADLABEL ${l.id}: ${String(e).slice(0,100)}`);continue;}
  if(s.passed)ok++;
  rows.push(`${p.status==='candidate'?'RUNNABLE':'BLOCKED '} ${l.id} contract=${s.passed?'ok':'FAIL['+s.cases.filter((c:any)=>!c.passed).slice(0,3).map((c:any)=>c.name).join('; ')+(s.fieldsCorrect?'':' fields:'+s.actualFields+' vs '+s.expectedFields)+(s.requiredCorrect?'':' req:'+s.actualRequired+' vs '+s.expectedRequired)+']'}`);
}
const extra=m.capabilities.filter(c=>c.status==='candidate'&&!labels.some((l:any)=>hit(l,c)));
console.log(rows.join('\n'));
console.log(`\nlabels ${labels.length}; discovered ${found}; contracts ok ${ok}/${found}`);
console.log('candidates not in labels:',[...new Set(extra.map(c=>`${c.component}.${c.handler}@${c.route}`))].join(' | '));

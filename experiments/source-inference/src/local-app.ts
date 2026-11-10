import {spawn,type ChildProcess} from 'node:child_process';
import {setTimeout} from 'node:timers/promises';
import {sampleDirectory,sampleUrl,type Sample} from './samples.js';

export async function ensureLocalApp(sample:Sample):Promise<ChildProcess|undefined> {
  const url=sampleUrl(sample);
  async function ready(){try {const response=await fetch(url,{signal:AbortSignal.timeout(1000)});return response.ok&&(await response.text()).includes('<');}catch{return false;}}
  if(await ready()) return;
  const child=spawn(process.execPath,['node_modules/@angular/cli/bin/ng.js','serve',sample.angularProject,'--host','127.0.0.1','--port',String(sample.port),'--no-live-reload'],{cwd:sampleDirectory(sample),stdio:['ignore','pipe','pipe'],env:{...process.env,NG_CLI_ANALYTICS:'false',NG_BUILD_MAX_WORKERS:'2'}});
  let log=''; child.stdout?.on('data',data=>{log=(log+data).slice(-12000);});child.stderr?.on('data',data=>{log=(log+data).slice(-12000);});
  for(let i=0;i<180;i++){if(await ready())return child;if(child.exitCode!==null||/Application bundle generation failed|Failed to compile/.test(log)){child.kill();throw new Error(`${sample.id} failed to start:\n${log}`);}await setTimeout(500);}
  child.kill();throw new Error(`${sample.id} timed out:\n${log}`);
}

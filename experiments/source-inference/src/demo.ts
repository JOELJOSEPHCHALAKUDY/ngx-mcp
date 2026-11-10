import {parseArgs} from 'node:util';
import {getSample} from './samples.js';
import {runScenario} from '../samples/run-scenario.js';
const {values}=parseArgs({options:{sample:{type:'string',default:'user-crud'},headless:{type:'boolean',default:false},once:{type:'boolean',default:false}}});
console.log(JSON.stringify(await runScenario(getSample(values.sample),!values.headless),null,2));

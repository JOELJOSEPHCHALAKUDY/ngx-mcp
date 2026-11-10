#!/usr/bin/env node
import {spawn} from 'node:child_process';import {resolve} from 'node:path';import {catalog,sourceDirectory} from './fixtures.mjs';
const args=process.argv.slice(2),value=(name,fallback)=>args.includes('--'+name)?args[args.indexOf('--'+name)+1]:fallback;
const project=catalog.projects.find(p=>p.id===value('project',''));if(!project)throw new Error('Choose --project finance|todo|shopping');const source=value('source',sourceDirectory(project)),port=value('port',String(project.port));
const child=spawn(process.execPath,[resolve(source,'node_modules/@angular/cli/bin/ng.js'),'serve','--host','127.0.0.1','--port',port],{cwd:source,stdio:'inherit'});for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));child.on('exit',code=>process.exitCode=code??1);

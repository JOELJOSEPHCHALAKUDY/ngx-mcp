import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';

export const digest=value=>createHash('sha256').update(value).digest('hex');

/** Preserve the historical digest format: ordered supplied paths, NUL, byte SHA, newline. */
export function treeDigest(directory){
 const files=[];
 function walk(path){for(const entry of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=join(path,entry.name);if(entry.isDirectory())walk(file);else if(entry.isFile())files.push(file);}}
 walk(directory);
 return digest(files.map(file=>file+'\0'+digest(readFileSync(file))).join('\n'));
}

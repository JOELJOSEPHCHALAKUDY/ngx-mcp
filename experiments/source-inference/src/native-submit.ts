import ts from 'typescript';
import {ASTWithSource,TmplAstElement,parseTemplate} from '@angular/compiler';
import {allElements} from './workflow-compiler.js';
import {matchingComponents} from './template-components.js';
import {Project,nameOf} from './project.js';
/** Resolve a source-declared submit wrapper to the actual native button; clicking the wrapper is not HTML submission. */
export function nativeSubmit(project:Project,selectors:Map<string,ts.ClassDeclaration[]>,node:TmplAstElement,selectorFor:(node:TmplAstElement)=>string):string|undefined{
  if(node.outputs.some(o=>o.name==='click'))return;
  const type=node.attributes.find(a=>a.name==='type')?.value;
  if(node.name==='button')return ['button','reset'].includes(type??'submit')?undefined:selectorFor(node);
  if(node.name==='input')return type==='submit'?selectorFor(node):undefined;
  if(type!=='submit')return;
  const candidates=matchingComponents(selectors,node);if(candidates.length!==1)return;
  const component=candidates[0],template=project.template(component);if(!template)return;
  const typeInputs=component.members.filter(m=>ts.isPropertyDeclaration(m)&&ts.getDecorators(m)?.some(d=>/^@Input(?:\(|\b)/.test(d.getText()))&&(nameOf(m)==='type'||ts.getDecorators(m)?.some(d=>d.getText().includes("'type'")||d.getText().includes('"type"')))).map(nameOf);
  const nodes=allElements(parseTemplate(template.text,template.file).nodes);
  const native=nodes.filter(el=>el.name==='button'&&el.inputs.some(i=>i.name==='type'&&i.value instanceof ASTWithSource&&typeInputs.includes(i.value.source??'')));
  return native.length===1?`${selectorFor(node)} button[type="submit"]`:undefined;
}

import ts from 'typescript';
import {ASTWithSource,TmplAstElement,TmplAstTemplate,parseTemplate} from '@angular/compiler';
import type {Capability,Schema,SourceRef} from './model.js';
import {Project} from './project.js';

type Node=ReturnType<typeof parseTemplate>['nodes'][number];
export interface StaticRouterLinks {drive:NonNullable<Capability['drive']>;inputSchema:Schema;source:SourceRef;}
/** Static authored anchors are clicked through Angular's router; no arbitrary URL or direct service call is exposed. */
export function staticRouterLinks(project:Project,cls:ts.ClassDeclaration,nodes:Node[],componentSelector:string,selectorFor:(node:TmplAstElement)=>string):StaticRouterLinks|undefined{
 const template=project.template(cls);if(!template)return;
 const choices:{value:string;selector:string;matchText?:string}[]=[];let source:SourceRef|undefined;
 const visit=(node:Node,repeated=false)=>{
  const loop=repeated||node.constructor.name==='ForLoopBlock'||node instanceof TmplAstTemplate&&node.templateAttrs.some(attribute=>['ngFor','ngForOf'].includes(attribute.name));
  if(node instanceof TmplAstElement&&!loop&&node.name==='a'&&!node.outputs.some(output=>output.name==='click')&&!node.inputs.some(input=>['queryParams','fragment','state'].includes(input.name))&&!node.attributes.some(attribute=>['queryParams','fragment','state'].includes(attribute.name))){
   const attribute=node.attributes.find(attribute=>attribute.name==='routerLink');
   const binding=node.inputs.find(input=>input.name==='routerLink')?.value;
   const constant=binding instanceof ASTWithSource?(binding.ast as unknown as {value?:unknown}).value:undefined;
   const path=attribute?.value??(typeof constant==='string'?constant:undefined);
   if(path&&/^\/(?!\/)[^?#]*$/.test(path)&&!path.split('/').some(part=>part==='.'||part==='..')&&!/[:*]/.test(path)){
    const label=template.text.slice(node.startSourceSpan.end.offset,node.endSourceSpan?.start.offset??node.sourceSpan.end.offset).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
    if(!label.includes('{{')){
     choices.push({value:path,selector:`${componentSelector} ${selectorFor(node)}`,...label?{matchText:label}:{}});
     source??={file:template.file,line:(attribute?.sourceSpan??node.sourceSpan).start.line+template.lineOffset+1};
    }
   }
  }
  const value=node as unknown as {children?:Node[];branches?:{children:Node[]}[];cases?:{children:Node[]}[];groups?:{children:Node[]}[]};
  for(const child of [...value.children??[],...[...value.branches??[],...value.cases??[],...value.groups??[]].flatMap(branch=>branch.children)])visit(child,loop);
 };
 nodes.forEach(node=>visit(node));
 if(!choices.length||!source||new Set(choices.map(choice=>choice.value)).size!==choices.length)return;
 // A shared selector needs distinct authored text so the runtime never picks an arbitrary anchor.
 if(choices.some(choice=>choices.filter(other=>other.selector===choice.selector).length>1&&(!choice.matchText||choices.filter(other=>other.selector===choice.selector&&other.matchText===choice.matchText).length>1)))return;
 return {drive:{buttons:{param:'route',choices}},inputSchema:{type:'object',properties:{route:{type:'string',enum:choices.map(choice=>choice.value)}},required:['route'],additionalProperties:false},source};
}

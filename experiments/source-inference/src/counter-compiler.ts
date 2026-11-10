import ts from 'typescript';
import {parseTemplate,ASTWithSource,Call,PropertyRead,ImplicitReceiver,TmplAstElement} from '@angular/compiler';
import {allElements} from './workflow-compiler.js';
import {Project,nameOf} from './project.js';
import type {CounterBinding} from './model.js';
export interface CounterWidget {output:string;input:string;binding:Omit<CounterBinding,'param'|'path'|'selector'|'submitAction'>;minimum?:number;}
/** A source-proven two-button widget emitting its current input +/- one. No component-name convention. */
export function counterWidget(project:Project,cls:ts.ClassDeclaration):CounterWidget|undefined{
  const template=project.template(cls);if(!template)return;
  const parsed=parseTemplate(template.text,template.file),elements=allElements(parsed.nodes);
  const choices: {node:TmplAstElement;output:string;input:string;delta:number}[]=[];
  for(const node of elements)for(const event of node.outputs){
    if(event.name!=='click'||!(event.handler instanceof ASTWithSource)||!(event.handler.ast instanceof Call))continue;
    const call=event.handler.ast,receiver=call.receiver;
    if(!(receiver instanceof PropertyRead)||receiver.name!=='emit'||!(receiver.receiver instanceof PropertyRead)||!(receiver.receiver.receiver instanceof ImplicitReceiver)||call.args.length!==1)continue;
    const expression=call.args[0] as unknown as {operation?:string;left?:unknown;right?:{value?:unknown}};
    const read=expression.left;
    if(!['+','-'].includes(expression.operation??'')||expression.right?.value!==1||!(read instanceof Call)||read.args.length||!(read.receiver instanceof PropertyRead)||!(read.receiver.receiver instanceof ImplicitReceiver))continue;
    const output=receiver.receiver.name,input=read.receiver.name;
    if(!cls.members.some(m=>ts.isPropertyDeclaration(m)&&nameOf(m)===output&&/^(output\b|new\s+EventEmitter\b)/.test(m.initializer?.getText()??'')))continue;
    choices.push({node,output,input,delta:expression.operation==='+'?1:-1});
  }
  if(choices.length!==2||choices[0].output!==choices[1].output||choices[0].input!==choices[1].input)return;
  const inc=choices.find(c=>c.delta===1),dec=choices.find(c=>c.delta===-1);if(!inc||!dec)return;
  const selector=(node:TmplAstElement)=>{const id=node.attributes.find(a=>a.name==='id')?.value;if(id&&/^[\w-]+$/.test(id))return '#'+id;const classes=(node.attributes.find(a=>a.name==='class')?.value??'').split(/\s+/).filter(v=>/^[a-zA-Z_][\w-]*$/.test(v));return node.name+classes.map(v=>'.'+v).join('');};
  const label=(node:TmplAstElement)=>template.text.slice(node.startSourceSpan.end.offset,node.endSourceSpan?.start.offset??node.sourceSpan.end.offset).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  const display=elements.filter(e=>e!==inc.node&&e!==dec.node&&new RegExp(`\\{\\{\\s*${inc.input}\\s*\\(\\s*\\)\\s*\\}\\}`).test(template.text.slice(e.startSourceSpan.end.offset,e.endSourceSpan?.start.offset??e.sourceSpan.end.offset))).sort((a,b)=>(a.sourceSpan.end.offset-a.sourceSpan.start.offset)-(b.sourceSpan.end.offset-b.sourceSpan.start.offset))[0];
  if(!display)return;
  const disabled=dec.node.inputs.find(i=>i.name==='disabled')?.value;
  const min=disabled instanceof ASTWithSource?new RegExp(`^\\s*${inc.input}\\(\\)\\s*===?\\s*(\\d+)\\s*$`).exec(disabled.source??''):undefined;
  return {output:inc.output,input:inc.input,binding:{increment:{selector:selector(inc.node),label:label(inc.node)},decrement:{selector:selector(dec.node),label:label(dec.node)},valueSelector:selector(display)},...(min?{minimum:Number(min[1])}:{})};
}

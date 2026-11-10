import ts from 'typescript';
import {ASTWithSource,TmplAstElement,parseTemplate} from '@angular/compiler';
import {Project,nameOf} from './project.js';
import {matchingComponents} from './template-components.js';
import {allElements,attribute,templateControlRules,constrainControlSchema,staticTemplateValues} from './workflow-compiler.js';
import type {Field,Schema} from './model.js';
type Node=ReturnType<typeof parseTemplate>['nodes'][number];
type SelectorMap=Map<string,ts.ClassDeclaration[]>;
const normalized=(value:string)=>value.trim().replace(/^this\./,'').replace(/\?\.\(/g,'(').replace(/\?\./g,'.');
function inputs(project:Project,cls:ts.ClassDeclaration){
 const map=new Map<string,string>();
 for(const member of cls.members){
  const own=nameOf(member);if(!own)continue;
  for(const decorator of ts.getDecorators(member as ts.HasDecorators)??[]){const call=ts.isCallExpression(decorator.expression)?decorator.expression:undefined;if(call&&project.angularFunction(call.expression,'Input'))map.set(project.string(call.arguments[0])??project.string(project.property(project.object(call.arguments[0]),'alias'))??own,own);}
  if(ts.isPropertyDeclaration(member)&&member.initializer&&ts.isCallExpression(member.initializer)){
   const call=member.initializer,callee=ts.isPropertyAccessExpression(call.expression)?call.expression.expression:call.expression;
   if(project.angularFunction(callee,'input'))map.set(call.arguments.map(argument=>project.string(project.property(project.object(argument),'alias'))).find(Boolean)??own,own);
  }
 }
 return map;
}
function formField(cls:ts.ClassDeclaration,form:string,expression:string):string|undefined{
 const source=normalized(expression),aliases=new Set([`${form}.controls`]);
 for(const member of cls.members){
  const expression=ts.isGetAccessorDeclaration(member)?member.body?.statements.length===1&&ts.isReturnStatement(member.body.statements[0])?member.body.statements[0].expression:undefined:ts.isPropertyDeclaration(member)&&member.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.ReadonlyKeyword)?member.initializer:undefined;
  if(expression&&normalized(expression.getText())===`${form}.controls`)aliases.add(nameOf(member));
 }
 for(const alias of aliases){if(source.startsWith(alias+'.')){const name=source.slice(alias.length+1);if(/^\w+$/.test(name))return name;}const bracket=/^(.+)\[['"](\w+)['"]\]$/.exec(source);if(bracket?.[1]===alias)return bracket[2];}
 const call=/^(.+)\.get\(['"](\w+)['"]\)$/.exec(source);return call?.[1]===form?call[2]:undefined;
}
function children(node:Node):Node[]{const item=node as unknown as {children?:Node[];branches?:{children:Node[]}[];cases?:{children:Node[]}[]};return item.children??item.branches?.flatMap(branch=>branch.children)??item.cases?.flatMap(branch=>branch.children)??[];}
function selector(node:TmplAstElement,nodes:Node[]):string|undefined{
 const id=attribute(node,'id');if(id)return `${node.name}[id=${JSON.stringify(id)}]`;
 if(allElements(nodes).filter(element=>element.name===node.name).length===1)return node.name;
 function walk(list:Node[],path:string[]):string|undefined{
  const counts=new Map<string,number>();for(const item of list){if(!(item instanceof TmplAstElement)){if(allElements(children(item)).includes(node))return;continue;}const index=(counts.get(item.name)??0)+1;counts.set(item.name,index);const next=[...path,`${item.name}:nth-of-type(${index})`];if(item===node)return next.join(' > ');if(['ng-container','ng-template'].includes(item.name)&&allElements(item.children).includes(node))return;const nested=walk(item.children,next);if(nested)return nested;}return;
 }
 return walk(nodes,[]);
}
function optionType(project:Project,cls:ts.ClassDeclaration,control:TmplAstElement):Record<string,unknown>{
 const nodes=control.children;
 const literal=allElements(nodes).filter(option=>['option','mat-option','nz-option'].includes(option.name)).flatMap(option=>{const value=attribute(option,'value')??attribute(option,'nzValue');return value===undefined?[]:[value];});
 if(literal.length)return {type:'string',enum:[...new Set(literal)]};
 let found:ts.Type|undefined;
 function walk(list:Node[]){for(const node of list){
  const loop=node as unknown as {item?:{name:string};expression?:ASTWithSource};
  if(loop.item&&loop.expression instanceof ASTWithSource){
   const list=normalized(loop.expression.source??''),member=cls.members.find(member=>nameOf(member)===list);
   const option=allElements(children(node)).find(option=>option.inputs.some(input=>['value','ngValue','nzValue'].includes(input.name)));
   const value=option?.inputs.find(input=>['value','ngValue','nzValue'].includes(input.name))?.value;
   if(member&&value instanceof ASTWithSource){const source=normalized(value.source??''),prefix=loop.item.name;let type=project.checker.getIndexTypeOfType(project.checker.getTypeAtLocation(member),ts.IndexKind.Number);
    if(type&&source.startsWith(prefix+'.'))for(const part of source.slice(prefix.length+1).split('.')){const property:ts.Symbol|undefined=type.getProperty(part);type=property?project.checker.getTypeOfSymbolAtLocation(property,member):undefined;if(!type)break;}
    else if(source!==prefix)type=undefined;
    if(type)found=type;
    if(source===prefix){const values=staticTemplateValues(project,cls,list);if(values?.length)found=undefined;}
   }
  }
  walk(children(node));
 }}walk(nodes);
 if(found){
  const types=found.isUnion()?found.types:[found];const values=types.map(type=>type.flags&ts.TypeFlags.StringLiteral?(type as ts.StringLiteralType).value:type.flags&ts.TypeFlags.NumberLiteral?(type as ts.NumberLiteralType).value:undefined);
  if(values.every(value=>value!==undefined)&&values.length)return {type:typeof values[0]==='number'?'number':'string',enum:[...new Set(values)]};
  if(found.flags&ts.TypeFlags.Number)return {type:'number'};
 }
 return {type:'string'};
}
/** Source-proven FormControl inputs are followed through component boundaries; unsupported controls stay explicit. */
export function wrappedControls(project:Project,parent:ts.ClassDeclaration,host:TmplAstElement,form:string|undefined,selectors:SelectorMap,nodes:Node[]):{fields:Field[];issues:string[]}|undefined{
 if(!form)return;
 const classes=matchingComponents(selectors,host);if(classes.length!==1)return;
 const child=classes[0],aliases=inputs(project,child),seeds=new Map<string,string>(),issues:string[]=[];
 const parsed=project.template(child);if(!parsed)return;
 const childNodes=parseTemplate(parsed.text,parsed.file,{preserveWhitespaces:false}).nodes;
 const direct=allElements(childNodes).flatMap(element=>element.inputs.filter(input=>input.name==='formControl').map(input=>input.value instanceof ASTWithSource?normalized(input.value.source??'').replace(/\(\)$/,''):''));
 for(const binding of host.inputs){const own=aliases.get(binding.name);if(!own||!(binding.value instanceof ASTWithSource))continue;const name=formField(parent,form,binding.value.source??'');if(name)seeds.set(own,name);else if(direct.includes(own))issues.push(`Wrapper control ${binding.value.source} cannot be resolved to ${form}.controls`);}
 if(!seeds.size)return issues.length?{fields:[],issues}:undefined;
 const prefix=selector(host,nodes);const fields:Field[]=[];
 function visit(cls:ts.ClassDeclaration,roots:Node[],names:Map<string,string>,namespace:string[],seen:Set<ts.ClassDeclaration>){
  if(seen.has(cls)||seen.size>=6){issues.push('Nested control wrappers are recursive or too deep');return;}
  const next=new Set(seen).add(cls);
  for(const element of allElements(roots)){
   const binding=element.inputs.find(input=>input.name==='formControl')?.value;
   const name=binding instanceof ASTWithSource?names.get(normalized(binding.source??'').replace(/\(\)$/,'')):undefined;
   if(name){
    const own=selector(element,roots),supported=['input','textarea','select','mat-select','mat-checkbox','mat-slide-toggle','nz-select'].includes(element.name)&&!!own;
    const type=attribute(element,'type')??'text';const multiple=attribute(element,'multiple')!==undefined||['multiple','tags'].includes(attribute(element,'nzMode')??'')||element.inputs.some(input=>input.name==='multiple'&&input.value instanceof ASTWithSource&&input.value.source==='true');
    const options=optionType(project,cls,element);const base=element.name==='mat-checkbox'||element.name==='mat-slide-toggle'||type==='checkbox'?{type:'boolean'}:type==='number'?{type:'number'}:type==='password'?{type:'string',writeOnly:true}:['select','mat-select','nz-select'].includes(element.name)?options:{type:'string'};
    const rules=templateControlRules(project,cls,element);const schema=constrainControlSchema(multiple?{type:'array',items:base}:base,rules,!!rules.required);
    const values=typeof options==='object'?options.enum as (string|number)[]|undefined:undefined;
    const usable=supported&&!['file','hidden','radio'].includes(type)&&!(multiple&&element.name==='select');
    fields.push({name,selector:[...namespace,own??element.name].join(' '),element:element.name,type,required:!!rules.required,supported:usable,adapter:element.name==='nz-select'||multiple&&element.name==='mat-select'?'aria-select':element.name==='mat-select'?'material-select':element.name==='mat-checkbox'?'material-checkbox':element.name==='mat-slide-toggle'?'material-toggle':'native',schema,...(['select','mat-select','nz-select'].includes(element.name)?{dynamicOptions:!values?.length,...(values?.length?{options:values.map(value=>({value:String(value),label:String(value)}))}:{})}:{})});
    if(!usable)issues.push(`Wrapper control ${name} needs an unsupported widget or unique namespace`);
    continue;
   }
   const matches=matchingComponents(selectors,element);if(matches.length!==1)continue;const nested=matches[0],nestedAliases=inputs(project,nested),forwarded=new Map<string,string>();
   for(const input of element.inputs){const own=nestedAliases.get(input.name);if(!own||!(input.value instanceof ASTWithSource))continue;const name=names.get(normalized(input.value.source??'').replace(/\(\)$/, ''));if(name)forwarded.set(own,name);}
   if(!forwarded.size)continue;const template=project.template(nested),own=selector(element,roots);if(!template||!own){issues.push('Nested control wrapper needs a unique source namespace');continue;}
   visit(nested,parseTemplate(template.text,template.file,{preserveWhitespaces:false}).nodes,forwarded,[...namespace,own],next);
  }
 }
 if(prefix)visit(child,childNodes,seeds,[prefix],new Set());else issues.push('Control wrapper has no unique source namespace');
 for(const name of new Set(seeds.values())){const found=fields.filter(field=>field.name===name);if(found.length!==1)issues.push(`Wrapper control ${name} maps to ${found.length} editable controls`);}
 return {fields,issues};
}


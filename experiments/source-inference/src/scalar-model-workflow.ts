import ts from 'typescript';
import {ASTWithSource,Call,ImplicitReceiver,PropertyRead,TmplAstElement,parseTemplate} from '@angular/compiler';
import {Project,nameOf} from './project.js';
import {allElements,attribute,templateControlRules,constrainControlSchema} from './workflow-compiler.js';
import {handlerConstraints,constrainHandlerInput} from './handler-constraints.js';
import type {Capability,Field,Schema} from './model.js';
type Node=ReturnType<typeof parseTemplate>['nodes'][number];
const compact=(text:string)=>text.replace(/\s+/g,'');
function member(node:unknown):string|undefined{return node instanceof PropertyRead&&node.receiver instanceof ImplicitReceiver?node.name:undefined;}
function callName(node:unknown):string|undefined{return node instanceof Call&&!node.args.length?member(node.receiver):undefined;}
function eventValue(node:unknown,event:string,property:string):boolean{
 if(event==='ngModelChange')return member(node)==='$event';
 if(!(node instanceof PropertyRead)||node.name!==property)return false;
 let target=node.receiver;
 if(target instanceof Call&&member(target.receiver)==='$any'&&target.args.length===1)target=target.args[0];
 return target instanceof PropertyRead&&target.name==='target'&&member(target.receiver)==='$event';
}
/** Native controls with a source-proven signal getter and its authored setter are business inputs, not arbitrary state. */
export function scalarModelFields(project:Project,cls:ts.ClassDeclaration,nodes:Node[],handler:ts.MethodDeclaration,bindings:Capability['bindings'],selectorFor:(element:TmplAstElement)=>string):{fields:Field[];issues:string[]}|undefined{
 if(handler.parameters.length||!handler.body)return;
 const controls=new Map<string,TmplAstElement[]>();
 const editable=new Set<TmplAstElement>();
 for(const element of allElements(nodes)){
  if(!['input','textarea'].includes(element.name)||['file','hidden','radio'].includes(attribute(element,'type')??''))continue;
  const read=element.inputs.find(input=>['value','ngModel','checked'].includes(input.name))?.value;
  const signal=read instanceof ASTWithSource?callName(read.ast):undefined;if(!signal)continue;
  const declaration=cls.members.find((member):member is ts.PropertyDeclaration=>ts.isPropertyDeclaration(member)&&nameOf(member)===signal);
  if(!declaration?.initializer||!ts.isCallExpression(declaration.initializer)||!project.angularFunction(declaration.initializer.expression,'signal'))continue;
  const event=element.outputs.find(output=>['input','change','ngModelChange'].includes(output.name)&&output.handler instanceof ASTWithSource&&output.handler.ast instanceof Call&&output.handler.ast.receiver instanceof PropertyRead&&output.handler.ast.receiver.name==='set'&&member(output.handler.ast.receiver.receiver)===signal&&output.handler.ast.args.length===1&&eventValue(output.handler.ast.args[0],output.name,attribute(element,'type')==='checkbox'?'checked':attribute(element,'type')==='number'?'valueAsNumber':'value'));
  controls.set(signal,[...controls.get(signal)??[],element]);if(event)editable.add(element);
 }
 if(!controls.size)return;
 const active=new Set(controls.keys()),aliases=new Map<string,string>(),found=new Map<string,{name:string;schema:Record<string,unknown>;required:boolean}>(),issues:string[]=[];
 const consumers=new Set<string>();
 function origin(node:ts.Expression):string|undefined{
  while(ts.isAsExpression(node)||ts.isParenthesizedExpression(node)||ts.isNonNullExpression(node))node=node.expression;
  if(ts.isIdentifier(node))return aliases.get(node.text);
  if(ts.isCallExpression(node)&&!node.arguments.length&&ts.isPropertyAccessExpression(node.expression)){
   const callee=node.expression;if(callee.expression.kind===ts.SyntaxKind.ThisKeyword&&active.has(callee.name.text))return callee.name.text;
   if(callee.name.text==='trim')return origin(callee.expression);
  }
  return;
 }
 function visit(node:ts.Node):void{
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)){
   const method=node.expression.name.text;
   const matches=bindings.filter(binding=>binding.method===method&&binding.arguments.length===node.arguments.length&&binding.arguments.every((argument,index)=>compact(argument)===compact(node.arguments[index].getText())));
   for(const binding of matches){
    const schema=typeof binding.inputSchema==='object'?binding.inputSchema as {properties?:Record<string,Schema>;required?:string[]}:undefined;
    if(!schema?.properties)continue;
    for(const [index,argument]of node.arguments.entries()){
     const source=origin(argument);if(!source)continue;
     const param=Object.keys(schema.properties)[index],name=binding.paramKeys?.[param]??param,property=schema.properties[param];
     if(!name||typeof property!=='object'||!['string','number','integer','boolean'].includes(String(property.type))){issues.push('Signal input reaches a non-scalar business parameter');continue;}
     const previous=found.get(source);if(previous&&previous.name!==name)issues.push('One signal input reaches differently named business parameters');
     else{found.set(source,{name,schema:property,required:!!schema.required?.includes(param)});consumers.add(method);}
    }
   }
   const receiver=node.expression.expression;
   if(['set','update'].includes(method)&&ts.isPropertyAccessExpression(receiver)&&receiver.expression.kind===ts.SyntaxKind.ThisKeyword)active.delete(receiver.name.text);
  }
  if(ts.isBinaryExpression(node)&&node.operatorToken.kind>=ts.SyntaxKind.FirstAssignment&&node.operatorToken.kind<=ts.SyntaxKind.LastAssignment){if(ts.isIdentifier(node.left))aliases.delete(node.left.text);if(ts.isPropertyAccessExpression(node.left)&&node.left.expression.kind===ts.SyntaxKind.ThisKeyword)active.delete(node.left.name.text);}
  ts.forEachChild(node,visit);
 }
 for(const statement of handler.body.statements){
  if(ts.isVariableStatement(statement)&&(statement.declarationList.flags&ts.NodeFlags.Const))for(const declaration of statement.declarationList.declarations)if(ts.isIdentifier(declaration.name)&&declaration.initializer){const source=origin(declaration.initializer);if(source)aliases.set(declaration.name.text,source);}
  visit(statement);
 }
 if(!found.size)return issues.length?{fields:[],issues}:undefined;
 const seeds=new Map([...found].map(([source,binding])=>[`this.${source}()`,binding.name]));
 const constraints=handlerConstraints(handler,[...consumers],seeds),fields:Field[]=[];
 for(const [source,binding]of found){
  const elements=controls.get(source)!;if(elements.length!==1){issues.push(`Signal ${source} has ${elements.length} authored editable controls`);continue;}
  const element=elements[0],type=attribute(element,'type')??'text',schema=constrainControlSchema(binding.schema,templateControlRules(project,cls,element),binding.required);
  const supported=editable.has(element);if(!supported)issues.push(`Signal ${source} has no source-proven native UI setter`);
  fields.push({name:binding.name,sourceName:source,selector:selectorFor(element),element:element.name,type,adapter:'native',required:binding.required,supported,schema:constrainHandlerInput(schema,constraints.get(binding.name))});
 }
 if(new Set(fields.map(field=>field.name)).size!==fields.length)issues.push('Different signal inputs map to the same business parameter');
 return {fields,issues};
}

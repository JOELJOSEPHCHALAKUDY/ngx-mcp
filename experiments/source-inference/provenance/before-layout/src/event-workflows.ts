import ts from 'typescript';
import {ASTWithSource,Call,ImplicitReceiver,Interpolation,PropertyRead,TmplAstBoundText,TmplAstElement,TmplAstTemplate,parseTemplate} from '@angular/compiler';
import {Project,nameOf} from './project.js';
import {SchemaCompiler} from './schema.js';
import {allElements} from './workflow-compiler.js';
import type {Capability,Field,Schema} from './model.js';

type TemplateNode=ReturnType<typeof parseTemplate>['nodes'][number];
export interface TextEventWorkflow {
  field:Field;
  commit:{event:'keyup';key:'Enter'}|{event:'blur'};
  reveal?:NonNullable<Capability['reveal']>&{event:'dblclick'};
  /** A single authored input can bind the same commit to both Enter and blur. */
  duplicateOfEnter:boolean;
  issues:string[];
}
const identifier=/^[A-Za-z_$][\w$]*$/;
function children(node:TemplateNode):TemplateNode[]{
 const value=node as unknown as {children?:TemplateNode[];branches?:{children:TemplateNode[]}[];cases?:{children:TemplateNode[]}[];groups?:{children:TemplateNode[]}[]};
 return [...value.children??[],...[...value.branches??[],...value.cases??[],...value.groups??[]].flatMap(branch=>branch.children)];
}
function pathOf(node:ts.Expression):string[]|undefined{
 while(ts.isParenthesizedExpression(node)||ts.isAsExpression(node)||ts.isNonNullExpression(node))node=node.expression;
 if(node.kind===ts.SyntaxKind.ThisKeyword)return [];
 if(!ts.isPropertyAccessExpression(node))return;
 const root=pathOf(node.expression);return root?[...root,node.name.text]:undefined;
}
function directCall(source:unknown):string|undefined{
 if(!(source instanceof ASTWithSource)||!(source.ast instanceof Call))return;
 const call=source.ast;
 return !call.args.length&&call.receiver instanceof PropertyRead&&call.receiver.receiver instanceof ImplicitReceiver?call.receiver.name:undefined;
}
function readsMember(method:ts.MethodDeclaration,member:string):boolean{
 let found=false;
 const visit=(node:ts.Node)=>{
  if(ts.isPropertyAccessExpression(node)&&pathOf(node)?.join('.')===member){
   const parent=node.parent;
   const write=ts.isBinaryExpression(parent)&&parent.left===node&&parent.operatorToken.kind===ts.SyntaxKind.EqualsToken;
   if(!write)found=true;
  }
  ts.forEachChild(node,visit);
 };visit(method);return found;
}
/** Recognize exactly `const text=this.field.trim(); if(text.length===0)return` (including negated length). */
function rejectsTrimmedBlank(method:ts.MethodDeclaration,member:string):boolean{
 if(!method.body)return false;
 const aliases=new Set<string>();
 const trimmed=(value:ts.Expression)=>ts.isCallExpression(value)&&value.arguments.length===0&&ts.isPropertyAccessExpression(value.expression)&&value.expression.name.text==='trim'&&pathOf(value.expression.expression)?.join('.')===member;
 for(const statement of method.body.statements){
  if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations)if(ts.isIdentifier(declaration.name)&&declaration.initializer&&trimmed(declaration.initializer))aliases.add(declaration.name.text);
  if(!ts.isIfStatement(statement)||statement.elseStatement)continue;
  const exits=ts.isReturnStatement(statement.thenStatement)||ts.isBlock(statement.thenStatement)&&statement.thenStatement.statements.length===1&&ts.isReturnStatement(statement.thenStatement.statements[0]);
  if(!exits)continue;
  const length=(expression:ts.Expression)=>ts.isPropertyAccessExpression(expression)&&expression.name.text==='length'&&((ts.isIdentifier(expression.expression)&&aliases.has(expression.expression.text))||trimmed(expression.expression));
  const condition=statement.expression;
  if(ts.isPrefixUnaryExpression(condition)&&condition.operator===ts.SyntaxKind.ExclamationToken&&length(condition.operand))return true;
  if(ts.isBinaryExpression(condition)&&[ts.SyntaxKind.EqualsEqualsEqualsToken,ts.SyntaxKind.EqualsEqualsToken,ts.SyntaxKind.LessThanEqualsToken].includes(condition.operatorToken.kind)&&length(condition.left)&&ts.isNumericLiteral(condition.right)&&Number(condition.right.text)===0)return true;
 }
 return false;
}
function guardedBy(nodes:TemplateNode[],action:TmplAstElement,flag:string):boolean{
 const visit=(node:TemplateNode,guarded=false):boolean=>{
  let active=guarded;
  if(node instanceof TmplAstTemplate){const condition=node.templateAttrs.find(attr=>attr.name==='ngIf')?.value;if(condition instanceof ASTWithSource&&condition.source?.trim()===flag)active=true;}
  if(node===action)return active;
  const branching=node as unknown as {branches?:{expression?:ASTWithSource;children:TemplateNode[]}[]};
  for(const branch of branching.branches??[])if(branch.children.some(child=>visit(child,active||branch.expression?.source?.trim()===flag)))return true;
  const ordinary=node as unknown as {children?:TemplateNode[]};
  return (ordinary.children??[]).some(child=>visit(child,active));
 };return nodes.some(node=>visit(node));
}
/** Native text events are driven through their authored DOM input, never by invoking a handler. */
export function textEventWorkflow(project:Project,cls:ts.ClassDeclaration,nodes:TemplateNode[],action:TmplAstElement,eventName:string,handler:ts.MethodDeclaration,componentSelector:string,selectorFor:(node:TmplAstElement)=>string):TextEventWorkflow|undefined{
 if(!['keyup.enter','blur'].includes(eventName)||!['input','textarea'].includes(action.name))return;
 const type=action.attributes.find(attribute=>attribute.name==='type')?.value??'text';
 if(!['text','search','email','url','tel','password'].includes(type))return;
 const binding=action.inputs.find(input=>input.name==='ngModel')?.value;
 const model=binding instanceof ASTWithSource?binding.source?.trim():undefined;
 if(!model||!identifier.test(model)||!readsMember(handler,model))return;
 const member=cls.members.find(member=>nameOf(member)===model);
 if(!member)return;
 const fieldType=project.checker.getTypeAtLocation(member);
 if(!(fieldType.flags&ts.TypeFlags.StringLike))return;
 const current=action.outputs.find(output=>output.name===eventName&&directCall(output.handler)===nameOf(handler));
 if(!current)return;
 const nonblank=rejectsTrimmedBlank(handler,model);
 const field:Field={name:model,selector:selectorFor(action),element:action.name,type,required:true,supported:true,adapter:'native',schema:{type:'string',...(nonblank?{pattern:'\\S'}:{})}};
 const candidates:NonNullable<TextEventWorkflow['reveal']>[]=[];
 for(const element of allElements(nodes))for(const output of element.outputs){
  if(output.name!=='dblclick')continue;
  const name=directCall(output.handler);const opener=name?cls.members.find((member):member is ts.MethodDeclaration=>ts.isMethodDeclaration(member)&&nameOf(member)===name):undefined;
  if(!opener?.body||opener.parameters.length||opener.body.statements.length!==1)continue;
  const statement=opener.body.statements[0];if(!ts.isExpressionStatement(statement)||!ts.isBinaryExpression(statement.expression))continue;
  const write=statement.expression;const path=pathOf(write.left);
  if(write.operatorToken.kind!==ts.SyntaxKind.EqualsToken||write.right.kind!==ts.SyntaxKind.TrueKeyword||path?.length!==1||!guardedBy(nodes,action,path[0]))continue;
  candidates.push({kind:'inline',trigger:`${componentSelector} ${selectorFor(element)}`,panel:`${componentSelector} ${selectorFor(action)}`,owner:componentSelector,event:'dblclick'});
 }
 return {field,commit:eventName==='keyup.enter'?{event:'keyup',key:'Enter'}:{event:'blur'},...(candidates.length===1?{reveal:candidates[0]}:{}),duplicateOfEnter:eventName==='blur'&&action.outputs.some(output=>output.name==='keyup.enter'&&directCall(output.handler)===nameOf(handler)),issues:candidates.length>1?['Text edit needs one unambiguous authored double-click opener']:[]};
}

function containingLoop(nodes:TemplateNode[],host:TmplAstElement,variable:string):{source:string;track:string}|undefined{
 const visit=(node:TemplateNode,loop?:{source:string;track:string}):{source:string;track:string}|undefined=>{
  const block=node as unknown as {item?:{name:string};expression?:ASTWithSource;trackBy?:ASTWithSource};
  const current=node.constructor.name==='ForLoopBlock'&&block.item?.name===variable?{source:block.expression?.source?.trim()??'',track:block.trackBy?.source?.trim()??''}:loop;
  if(node===host)return current;
  for(const child of children(node)){const found=visit(child,current);if(found)return found;}
 };for(const node of nodes){const found=visit(node);if(found)return found;}
}
function declarationClass(project:Project,member:ts.ClassElement):ts.ClassDeclaration|undefined{
 const symbol=project.checker.getTypeAtLocation(member).getSymbol();const declaration=symbol?.valueDeclaration??symbol?.declarations?.[0];return declaration&&ts.isClassDeclaration(declaration)?declaration:undefined;
}
/** Locate a source-proven full backing array without requiring runtime getters or service calls. */
function backingArray(project:Project,cls:ts.ClassDeclaration,source:string):string[]|undefined{
 const raw=source.replace(/^this\./,'');if(!identifier.test(raw))return;
 const member=cls.members.find(member=>nameOf(member)===raw);if(!member)return;
 if(ts.isPropertyDeclaration(member)&&project.checker.getIndexTypeOfType(project.checker.getTypeAtLocation(member),ts.IndexKind.Number))return [raw];
 if(!ts.isGetAccessorDeclaration(member)||!member.body)return;
 const returns:ts.Expression[]=[];
 const collect=(node:ts.Node)=>{if(ts.isReturnStatement(node)&&node.expression)returns.push(node.expression);else ts.forEachChild(node,collect);};collect(member.body);
 if(returns.length!==1)return;
 const expression=returns[0];const direct=pathOf(expression);
 if(direct?.length===1){const property=cls.members.find(item=>nameOf(item)===direct[0]);if(property&&ts.isPropertyDeclaration(property)&&project.checker.getIndexTypeOfType(project.checker.getTypeAtLocation(property),ts.IndexKind.Number))return direct;}
 if(!ts.isCallExpression(expression)||!ts.isPropertyAccessExpression(expression.expression))return;
 const receiver=pathOf(expression.expression.expression);if(receiver?.length!==1)return;
 const serviceMember=cls.members.find(item=>nameOf(item)===receiver[0]);if(!serviceMember)return;
 const service=declarationClass(project,serviceMember);if(!service)return;
 const methodName=expression.expression.name.text;
 const method=service.members.find((item):item is ts.MethodDeclaration=>ts.isMethodDeclaration(item)&&nameOf(item)===methodName);if(!method?.body)return;
 const arrays:string[][]=[];let unknown=false;
 const scan=(node:ts.Node)=>{
  if(ts.isReturnStatement(node)&&node.expression){
   let value=node.expression;
   if(ts.isCallExpression(value)&&ts.isPropertyAccessExpression(value.expression)&&value.expression.name.text==='filter')value=value.expression.expression;
   const path=pathOf(value);
   const property=path?.length===1?service.members.find(item=>nameOf(item)===path[0]):undefined;
   if(!path||!property||!ts.isPropertyDeclaration(property)||!project.checker.getIndexTypeOfType(project.checker.getTypeAtLocation(property),ts.IndexKind.Number))unknown=true;
   else arrays.push(path);
   return;
  }
  ts.forEachChild(node,scan);
 };scan(method.body);
 if(unknown||!arrays.length||new Set(arrays.map(path=>path.join('.'))).size!==1)return;
 return [...receiver,...arrays[0]];
}
/** An object-tracked hosted row may use its sole authored scalar display key, guarded by full-list runtime uniqueness. */
export function trackedDisplayIdentity(project:Project,parent:ts.ClassDeclaration,nodes:TemplateNode[],host:TmplAstElement,child:ts.ClassDeclaration):Capability['target']|undefined{
 const template=project.template(child);if(!template)return;
 const candidates:NonNullable<Capability['target']>[]=[];
 for(const member of child.members){
  if(!ts.isPropertyDeclaration(member))continue;
  const input=(ts.getDecorators(member)??[]).find(decorator=>ts.isCallExpression(decorator.expression)&&project.angularFunction(decorator.expression.expression,'Input'));
  if(!input||!ts.isCallExpression(input.expression))continue;
  const options=project.object(input.expression.arguments[0]);if(project.property(options,'transform'))continue;
  const inputName=nameOf(member),alias=project.string(input.expression.arguments[0])??project.string(project.property(options,'alias'))??inputName;
  const bound=host.inputs.find(binding=>binding.name===alias)?.value;
  const variable=bound instanceof ASTWithSource?bound.source?.trim():undefined;if(!variable||!identifier.test(variable))continue;
  const loop=containingLoop(nodes,host,variable);if(!loop)continue;
  const schema=new SchemaCompiler(project.checker).type(project.checker.getTypeAtLocation(member));
  const properties=typeof schema==='object'?(schema as {type?:string;properties?:Record<string,Schema>}).properties:undefined;if(!properties)continue;
  const keys=new Set<string>();
  const parse=parseTemplate(template.text,template.file);
  const scan=(node:TemplateNode)=>{
   if(node instanceof TmplAstBoundText&&node.value instanceof ASTWithSource&&node.value.ast instanceof Interpolation)for(const expression of node.value.ast.expressions){
    if(expression instanceof PropertyRead&&expression.receiver instanceof PropertyRead&&expression.receiver.name===inputName&&expression.receiver.receiver instanceof ImplicitReceiver){const keySchema=properties[expression.name];if(typeof keySchema==='object'&&['string','number','integer'].includes(String(keySchema.type)))keys.add(expression.name);}
   }
   children(node).forEach(scan);
  };parse.nodes.forEach(scan);
  if(keys.size!==1)continue;const key=[...keys][0];
  if(![variable,`${variable}.${key}`].includes(loop.track))continue;
  const collection=backingArray(project,parent,loop.source);if(!collection)continue;
  const owner=project.string(project.property(project.metadata(parent,'Component'),'selector'));if(!owner)continue;
  const rowSelector=project.string(project.property(project.metadata(child,'Component'),'selector'));if(!rowSelector)continue;
  const projected={owner,collection,labelPath:[key],rowSelector,rowInputPath:[inputName]};
  candidates.push({param:inputName,source:'context',path:[key],valuePath:[key],inputSchema:schema,projected});
 }
 return candidates.length===1?candidates[0]:undefined;
}

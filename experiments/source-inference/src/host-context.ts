import ts from 'typescript';
import {ASTWithSource,TmplAstElement,TmplAstTemplate,parseTemplate} from '@angular/compiler';
import {Project,nameOf} from './project.js';

type Node=ReturnType<typeof parseTemplate>['nodes'][number];
type Primitive=string|number|boolean|null|undefined;
export type HostValue={kind:'literal';value:Primitive}|{kind:'object'};
export type HostInputs=Map<string,HostValue>;
const literal=(text:string):HostValue|undefined=>{
 const s=text.trim();if(s==='undefined')return {kind:'literal',value:undefined};if(s==='null')return {kind:'literal',value:null};if(s==='true'||s==='false')return {kind:'literal',value:s==='true'};
 if(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s))return {kind:'literal',value:Number(s)};
 if(/^(['"])[\s\S]*\1$/.test(s)){const f=ts.createSourceFile('literal.ts','const value='+s,ts.ScriptTarget.Latest,true);const statement=f.statements[0];if(statement&&ts.isVariableStatement(statement)){const value=statement.declarationList.declarations[0].initializer;if(value&&ts.isStringLiteralLike(value))return {kind:'literal',value:value.text};}}
 return;
};
function inputs(project:Project,cls:ts.ClassDeclaration){return cls.members.flatMap(m=>{
 if(!ts.isPropertyDeclaration(m))return [];
 const decorator=(ts.getDecorators(m)??[]).find(d=>ts.isCallExpression(d.expression)&&project.angularFunction(d.expression.expression,'Input'));
 if(!decorator||!ts.isCallExpression(decorator.expression))return [];
 const argument=decorator.expression.arguments[0],options=project.object(argument),alias=project.string(argument)??project.string(project.property(options,'alias'))??nameOf(m);
 return [{member:m,name:nameOf(m),alias,transformed:!!project.property(options,'transform')}];
});}
function written(cls:ts.ClassDeclaration,name:string){let value=false;const refers=(n:ts.Node)=>new RegExp(`^this\\.${name}(?:\\.|\\[|$)`).test(n.getText());const visit=(n:ts.Node)=>{
 if(ts.isBinaryExpression(n)&&n.operatorToken.kind>=ts.SyntaxKind.FirstAssignment&&n.operatorToken.kind<=ts.SyntaxKind.LastAssignment&&refers(n.left))value=true;
 if((ts.isPostfixUnaryExpression(n)||ts.isPrefixUnaryExpression(n))&&[ts.SyntaxKind.PlusPlusToken,ts.SyntaxKind.MinusMinusToken].includes(n.operator)&&refers(n.operand))value=true;
 if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&refers(n.expression.expression)&&['set','update','next'].includes(n.expression.name.text))value=true;
 ts.forEachChild(n,visit);
 };visit(cls);return value;}
function childNodes(node:Node):Node[]{const n=node as unknown as {children?:Node[];branches?:{children:Node[]}[];cases?:{children:Node[]}[];groups?:{children:Node[]}[]};return [...n.children??[],...[...n.branches??[],...n.cases??[],...n.groups??[]].flatMap(x=>x.children)];}
function loopSource(nodes:Node[],target:Node,variable:string):string|undefined{
 const visit=(node:Node,source?:string):string|undefined=>{let current=source;
 if(node.constructor.name==='ForLoopBlock'){const loop=node as unknown as {item:{name:string};expression:ASTWithSource};if(loop.item.name===variable)current=loop.expression.source??undefined;}
 else if(node instanceof TmplAstTemplate&&node.variables.some(v=>v.name===variable&&(v.value===''||v.value==='$implicit'))){const value=node.templateAttrs.find(a=>a.name==='ngForOf')?.value;if(value instanceof ASTWithSource)current=value.source??undefined;}
 if(node===target)return current;for(const child of childNodes(node)){const found=visit(child,current);if(found!==undefined)return found;}return;
 };return nodes.map(n=>visit(n)).find(v=>v!==undefined);
}
function nonNullLoopObject(project:Project,parent:ts.ClassDeclaration,source:string|undefined):boolean{
 if(!source||!/^(?:this\.)?[A-Za-z_$][\w$]*(?:(?:\?\.|\.)[A-Za-z_$][\w$]*)*$/.test(source.trim()))return false;
 const path=source.trim().replace(/^this\./,'').split(/\?\.|\./),member=parent.members.find(m=>nameOf(m)===path[0]);if(!member)return false;
 const nonNull=(t:ts.Type)=>t.isUnion()?t.types.filter(v=>!(v.flags&(ts.TypeFlags.Null|ts.TypeFlags.Undefined))):[t];
 let types=nonNull(project.checker.getTypeAtLocation(member));let declared:ts.Node=member;
 for(const part of path.slice(1)){const next:ts.Type[]=[];for(const type of types){const prop=type.getProperty(part);if(!prop)return false;declared=prop.valueDeclaration??prop.declarations?.[0]??member;next.push(...nonNull(project.checker.getTypeOfSymbolAtLocation(prop,member)));}types=next;}
 // Preserve explicit nullable element declarations even in projects with strictNullChecks disabled.
 const declaredType=(declared as ts.Node&{type?:ts.TypeNode}).type;
 const nullable=(node:ts.TypeNode,seen=new Set<ts.Node>()):boolean=>{
  if(seen.has(node))return true;const next=new Set(seen).add(node);
  if([ts.SyntaxKind.AnyKeyword,ts.SyntaxKind.UnknownKeyword,ts.SyntaxKind.UndefinedKeyword].includes(node.kind)||ts.isLiteralTypeNode(node)&&node.literal.kind===ts.SyntaxKind.NullKeyword)return true;
  if(ts.isUnionTypeNode(node))return node.types.some(t=>nullable(t,next));
  if(ts.isArrayTypeNode(node))return nullable(node.elementType,next);
  if(ts.isParenthesizedTypeNode(node)||ts.isTypeOperatorNode(node))return nullable(node.type,next);
  if(ts.isTypeReferenceNode(node)){const alias=project.declaration(node.typeName);if(alias&&ts.isTypeAliasDeclaration(alias))return nullable(alias.type,next);if(['Array','ReadonlyArray'].includes(node.typeName.getText())&&node.typeArguments?.[0])return nullable(node.typeArguments[0],next);}
  return false;
 };
 if(declaredType&&nullable(declaredType))return false;
 const items=types.map(t=>project.checker.getIndexTypeOfType(t,ts.IndexKind.Number));
 return items.length>0&&items.every(t=>!!t&&!(t.flags&(ts.TypeFlags.Any|ts.TypeFlags.Unknown|ts.TypeFlags.TypeParameter))&&(t.isUnion()?t.types:[t]).every(v=>!!(v.flags&ts.TypeFlags.Object)&&!(v.flags&(ts.TypeFlags.Null|ts.TypeFlags.Undefined))));
}
/** A child host proves omitted defaults, literal bindings, parent-known inputs and non-null object loop items. */
export function hostInputsFor(project:Project,parent:ts.ClassDeclaration,child:ts.ClassDeclaration,host:TmplAstElement,nodes:Node[],parentInputs:HostInputs=new Map()):HostInputs{
 const result:HostInputs=new Map();
 for(const input of inputs(project,child)){
  if(input.transformed||written(child,input.name))continue;
  const binding=host.inputs.find(i=>i.name===input.alias),attribute=host.attributes.find(a=>a.name===input.alias);
  if(binding){const source=binding.value instanceof ASTWithSource?binding.value.source?.trim():undefined;let known=source===undefined?undefined:literal(source);
   const reference=source&&/^(?:this\.)?([A-Za-z_$][\w$]*)$/.exec(source)?.[1];if(!known&&reference)known=parentInputs.get(reference);
   if(!known&&reference&&nonNullLoopObject(project,parent,loopSource(nodes,host,reference)))known={kind:'object'};
   if(known)result.set(input.name,known);continue;
  }
  if(attribute){result.set(input.name,{kind:'literal',value:attribute.value});continue;}
  if(!input.member.initializer)result.set(input.name,{kind:'literal',value:undefined});
  else{const value=literal(input.member.initializer.getText());if(value)result.set(input.name,value);}
 }
 return result;
}
/** Only simple proven input conditions are folded; mutable fields and complex runtime expressions stay unknown. */
export function foldHostInput(expr:string,inputs:HostInputs):boolean|undefined{
 const source=expr.trim().replace(/^\((.*)\)$/,'$1').trim();
 const unary=/^(!)?\s*(?:this\.)?([A-Za-z_$][\w$]*)$/.exec(source);
 if(unary&&inputs.has(unary[2])){const known=inputs.get(unary[2])!,truth=known.kind==='object'||!!known.value;return unary[1]?!truth:truth;}
 const equality=/^(?:this\.)?([A-Za-z_$][\w$]*)\s*(===|!==|==|!=)\s*([\s\S]+)$/.exec(source);
 if(!equality||!inputs.has(equality[1]))return;
 const left=inputs.get(equality[1])!,right=literal(equality[3]);if(!right)return;
 let equal:boolean|undefined;
 if(left.kind==='object'){if(right.kind==='literal'&&(right.value===null||right.value===undefined))equal=false;else return;}
 else if(right.kind==='literal')equal=equality[2].length===3?left.value===right.value:left.value==right.value;
 return equal===undefined?undefined:equality[2].startsWith('!')?!equal:equal;
}

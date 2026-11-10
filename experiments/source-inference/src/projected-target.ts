import ts from 'typescript';
import {ASTWithSource,Interpolation,PropertyRead,ImplicitReceiver,TmplAstElement,TmplAstTemplate,TmplAstText,TmplAstBoundText,parseTemplate,type AST} from '@angular/compiler';
import {Project,nameOf} from './project.js';
import {matchingComponents} from './template-components.js';
import type {Capability} from './model.js';
type Node=ReturnType<typeof parseTemplate>['nodes'][number];
type Projection=NonNullable<NonNullable<Capability['target']>['projected']>;
function children(node:Node):Node[]{const n=node as unknown as {children?:Node[];branches?:{children:Node[]}[];cases?:{children:Node[]}[];groups?:{children:Node[]}[]};return [...n.children??[],...[...n.branches??[],...n.cases??[],...n.groups??[]].flatMap(x=>x.children)];}
function argumentPath(ast:AST):string[]|undefined{if(!(ast instanceof PropertyRead))return;if(ast.receiver instanceof ImplicitReceiver)return [ast.name];const root=argumentPath(ast.receiver);return root?[...root,ast.name]:undefined;}
/** Prove the item collection and exact text projection of a row whose Angular embedded context may be unavailable after projection. */
export function projectedTarget(project:Project,cls:ts.ClassDeclaration,nodes:Node[],row:TmplAstElement,args:AST[],target:NonNullable<Capability['target']>,owner:string,selectors:Map<string,ts.ClassDeclaration[]>):Projection|undefined{
 const ancestry:{variable:string;source:string}[][]=[];
 const visit=(node:Node,loops:{variable:string;source:string}[])=>{let next=loops;
  if(node.constructor.name==='ForLoopBlock'){const loop=node as unknown as {item:{name:string};expression:ASTWithSource};if(loop.expression.source)next=[...loops,{variable:loop.item.name,source:loop.expression.source}];}
  else if(node instanceof TmplAstTemplate){const source=node.templateAttrs.find(a=>a.name==='ngForOf')?.value,variable=node.variables.find(v=>v.value===''||v.value==='$implicit')?.name;if(variable&&source instanceof ASTWithSource&&source.source)next=[...loops,{variable,source:source.source}];}
  if(node===row)ancestry.push(next);for(const child of children(node))visit(child,next);
 };nodes.forEach(n=>visit(n,[]));
 if(ancestry.length!==1)return;
 const candidates=ancestry[0].filter(loop=>args.some(arg=>{const path=argumentPath(arg);return path?.[0]===loop.variable&&(path.length===1||path.slice(1).join('.')===target.path.join('.'));}));
 if(candidates.length!==1)return;
 const loop=candidates[0],collection=/^(?:this\.)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/.exec(loop.source.trim())?.[1]?.split('.');
 if(!collection)return;
 // A collection is read as data, never by executing a getter, callback or service method.
 const declaration=cls.members.find(m=>nameOf(m)===collection[0]);if(!declaration||!ts.isPropertyDeclaration(declaration))return;
 const path=(source:string,env:Map<string,string[]>):string[]|undefined=>{const parts=source.trim().replace(/\?\./g,'.').replace(/^this\./,'').split('.');if(!parts.every(p=>/^[A-Za-z_$][\w$]*$/.test(p)))return;const root=env.get(parts[0]);return root?[...root,...parts.slice(1)]:undefined;};
 const projectText=(list:Node[],env:Map<string,string[]>,seen=new Set<ts.ClassDeclaration>()):string[][]|undefined=>{
  const result:string[][]=[];
  for(const node of list){
   if(node instanceof TmplAstText){if(node.value.trim())return;continue;}
   if(node instanceof TmplAstBoundText){const value=node.value instanceof ASTWithSource?node.value.ast:node.value;if(!(value instanceof Interpolation)||value.strings.some(s=>s.trim())||value.expressions.length!==1)return;const expression=value.expressions[0] as unknown as {source?:string;name?:string};
    const source=node.value instanceof ASTWithSource?node.value.source?.replace(/^\s*{{|}}\s*$/g,'').trim():undefined;const resolved=source&&path(source,env);if(!resolved)return;result.push(resolved);continue;
   }
   if(node instanceof TmplAstElement){
    if(node.inputs.some(i=>['innerHTML','textContent','innerText'].includes(i.name)))return;
    const components=matchingComponents(selectors,node);
    if(components.length){if(components.length!==1||seen.has(components[0]))return;const component=components[0],template=project.template(component);if(!template)return;const parsed=parseTemplate(template.text,template.file);if(parsed.errors?.length)return;
     const childEnv=new Map<string,string[]>();
     for(const member of component.members){if(!ts.isPropertyDeclaration(member))continue;const input=(ts.getDecorators(member)??[]).find(d=>ts.isCallExpression(d.expression)&&project.angularFunction(d.expression.expression,'Input'));if(!input||!ts.isCallExpression(input.expression))continue;const option=project.object(input.expression.arguments[0]);if(project.property(option,'transform'))continue;const alias=project.string(input.expression.arguments[0])??project.string(project.property(option,'alias'))??nameOf(member);const binding=node.inputs.find(i=>i.name===alias)?.value;if(binding instanceof ASTWithSource&&binding.source){const mapped=path(binding.source,env);if(mapped)childEnv.set(nameOf(member),mapped);}}
     const nested=projectText(parsed.nodes,childEnv,new Set(seen).add(component));if(!nested)return;result.push(...nested);continue;
    }
    // The source cannot prove what an unavailable component or content projection adds to row text.
    if(node.name.includes('-')||node.name==='ng-content')return;
   }else if(node.constructor.name.includes('Content'))return;
   const nested=projectText(children(node),env,seen);if(!nested)return;result.push(...nested);
  }
  return result;
 };
 const labels=projectText(row.children,new Map([[loop.variable,[]]]));
 return labels?.length===1?{owner,collection,labelPath:labels[0]}:undefined;
}

import ts from 'typescript';
import {ASTWithSource,TmplAstTemplate,parseTemplate} from '@angular/compiler';
import {Project,nameOf} from './project.js';

type HtmlNode=ReturnType<typeof parseTemplate>['nodes'][number];
export interface TemplateCallback {
  method:ts.MethodDeclaration;
  identity:{path:string[];value:string|number};
}

/** Resolve data-driven template callbacks only when their bound component method and row identity are authored constants. */
export function resolveTemplateCallbacks(project:Project,cls:ts.ClassDeclaration,nodes:HtmlNode[],element:HtmlNode,variable:string,callback:string):TemplateCallback[]{
  const children=(node:HtmlNode):HtmlNode[]=>{
    const n=node as unknown as {children?:HtmlNode[];branches?:{children:HtmlNode[]}[];cases?:{children:HtmlNode[]}[];groups?:{children:HtmlNode[]}[]};
    return [...n.children??[],...[...n.branches??[],...n.cases??[],...n.groups??[]].flatMap(x=>x.children)];
  };
  const collection=(node:HtmlNode,source?:string):string|undefined=>{
    let active=source;
    if(node.constructor.name==='ForLoopBlock'){
      const loop=node as unknown as {item:{name:string};expression:ASTWithSource};
      if(loop.item.name===variable)active=loop.expression.source??undefined;
    }else if(node instanceof TmplAstTemplate&&node.variables.some(v=>v.name===variable&&(v.value===''||v.value==='$implicit'))){
      const value=node.templateAttrs.find(a=>a.name==='ngForOf')?.value;
      if(value instanceof ASTWithSource)active=value.source??undefined;
    }
    if(node===element)return active;
    for(const child of children(node)){const found=collection(child,active);if(found!==undefined)return found;}
    return undefined;
  };
  const source=nodes.map(n=>collection(n)).find(v=>v!==undefined);
  const member=/^(?:this\.)?([A-Za-z_$][\w$]*)$/.exec(source?.trim()??'')?.[1];
  if(!member)return [];
  const assignments:ts.Expression[]=[];
  let dynamic=false;
  const refers=(n:ts.Node)=>new RegExp(`^this\\.${member}(?:\\.|\\[|$)`).test(n.getText());
  const scan=(node:ts.Node)=>{
    if(ts.isPropertyDeclaration(node)&&node.parent===cls&&nameOf(node)===member&&node.initializer)assignments.push(node.initializer);
    if(ts.isBinaryExpression(node)&&node.operatorToken.kind>=ts.SyntaxKind.FirstAssignment&&node.operatorToken.kind<=ts.SyntaxKind.LastAssignment&&refers(node.left)){
      let owner:ts.Node|undefined=node.parent;while(owner&&owner!==cls&&!ts.isMethodDeclaration(owner)&&!ts.isConstructorDeclaration(owner))owner=owner.parent;
      const initializes=owner&&((ts.isConstructorDeclaration(owner))||(ts.isMethodDeclaration(owner)&&nameOf(owner)==='ngOnInit'));
      if(node.left.getText()===`this.${member}`&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken&&initializes)assignments.push(node.right);else dynamic=true;
    }
    if((ts.isPostfixUnaryExpression(node)||ts.isPrefixUnaryExpression(node))&&[ts.SyntaxKind.PlusPlusToken,ts.SyntaxKind.MinusMinusToken].includes(node.operator)&&refers(node.operand))dynamic=true;
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&refers(node.expression.expression)&&['push','pop','shift','unshift','splice','sort','reverse','fill','copyWithin','set','update'].includes(node.expression.name.text))dynamic=true;
    ts.forEachChild(node,scan);
  };
  scan(cls);
  if(dynamic||assignments.length!==1)return [];
  const stable=(node:ts.Expression,seen=new Set<ts.Node>()):ts.Expression|undefined=>{
    if(seen.has(node))return;const next=new Set(seen).add(node);
    if(ts.isAsExpression(node)||ts.isSatisfiesExpression(node)||ts.isParenthesizedExpression(node)||ts.isNonNullExpression(node))return stable(node.expression,next);
    if(ts.isIdentifier(node)){
      const d=project.declaration(node);
      if(d&&ts.isVariableDeclaration(d)&&d.initializer){if(!(d.parent.flags&ts.NodeFlags.Const))return;return stable(d.initializer,next);}
    }
    return node;
  };
  const values=(node:ts.Expression,seen=new Set<ts.Node>()):ts.Expression[]|undefined=>{
    const n=stable(node);if(!n||!ts.isArrayLiteralExpression(n)||seen.has(n))return;const next=new Set(seen).add(n);
    const result:ts.Expression[]=[];
    for(const item of n.elements){if(ts.isSpreadElement(item)){const rest=values(item.expression,next);if(!rest)return;result.push(...rest);}else result.push(item);}
    return result;
  };
  const entries=values(assignments[0]);if(!entries?.length)return [];
  const properties=(node:ts.Expression):Map<string,ts.Expression>|undefined=>{
    const n=stable(node);if(!n)return;
    if(ts.isObjectLiteralExpression(n)){
      const props=new Map<string,ts.Expression>();
      for(const p of n.properties){if(ts.isPropertyAssignment(p)&&!ts.isComputedPropertyName(p.name))props.set(nameOf(p),p.initializer);else if(ts.isShorthandPropertyAssignment(p))props.set(p.name.text,p.name);else return;}
      return props;
    }
    if(ts.isNewExpression(n)){
      const type=project.classAt(n.expression),ctor=type?.members.find(ts.isConstructorDeclaration);
      // A nonempty constructor may replace or wrap a callback; never infer what arbitrary constructor code does.
      if(!ctor||ctor.body?.statements.length)return;
      const props=new Map<string,ts.Expression>();
      for(let i=0;i<ctor.parameters.length;i++){
        const p=ctor.parameters[i];if(!ts.isIdentifier(p.name)||!p.modifiers?.some(m=>[ts.SyntaxKind.PublicKeyword,ts.SyntaxKind.PrivateKeyword,ts.SyntaxKind.ProtectedKeyword,ts.SyntaxKind.ReadonlyKeyword].includes(m.kind)))continue;
        const value=n.arguments?.[i]??p.initializer;if(value)props.set(p.name.text,value);
      }
      return props;
    }
    return;
  };
  const rows=entries.map(properties);if(rows.some(r=>!r))return [];
  const scalar=(node:ts.Expression|undefined):string|number|undefined=>{
    if(!node)return;const n=stable(node);if(!n)return;
    if(ts.isNumericLiteral(n))return Number(n.text);
    if(ts.isPrefixUnaryExpression(n)&&ts.isNumericLiteral(n.operand)&&[ts.SyntaxKind.MinusToken,ts.SyntaxKind.PlusToken].includes(n.operator))return (n.operator===ts.SyntaxKind.MinusToken?-1:1)*Number(n.operand.text);
    return project.string(n);
  };
  const result:TemplateCallback[]=[];
  for(const row of rows){
    const expression=stable(row!.get(callback)??assignments[0]);
    if(!expression||!ts.isCallExpression(expression)||!ts.isPropertyAccessExpression(expression.expression)||expression.expression.name.text!=='bind'||expression.arguments.length!==1||expression.arguments[0].kind!==ts.SyntaxKind.ThisKeyword)continue;
    const bound=expression.expression.expression;
    if(!ts.isPropertyAccessExpression(bound)||bound.expression.kind!==ts.SyntaxKind.ThisKeyword)continue;
    let lexical:ts.Node|undefined=bound;let componentThis=true;
    while(lexical&&lexical!==cls){if(ts.isFunctionDeclaration(lexical)||ts.isFunctionExpression(lexical)||ts.isMethodDeclaration(lexical)&&lexical.parent!==cls)componentThis=false;lexical=lexical.parent;}
    if(lexical!==cls||!componentThis)continue;
    const method=cls.members.find((m):m is ts.MethodDeclaration=>ts.isMethodDeclaration(m)&&!m.modifiers?.some(mod=>mod.kind===ts.SyntaxKind.StaticKeyword)&&nameOf(m)===bound.name.text);
    if(!method||method.parameters.some(p=>!p.questionToken&&!p.initializer))continue;
    const names=[...new Set(['tooltip','icon','id','key','name','label','title',...row!.keys()])].filter(k=>k!==callback);
    const key=names.find(k=>{const v=scalar(row!.get(k));return v!==undefined&&rows.filter(r=>{const other=scalar(r!.get(k));return other!==undefined&&String(other)===String(v);}).length===1;});
    if(key&&!result.some(r=>r.method===method))result.push({method,identity:{path:[key],value:scalar(row!.get(key))!}});
  }
  return result;
}

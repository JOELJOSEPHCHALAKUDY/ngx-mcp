import ts from 'typescript';
import {ASTWithSource, LiteralPrimitive, TmplAstElement, TmplAstTemplate, TmplAstText, parseTemplate} from '@angular/compiler';
import {Project, nameOf} from './project.js';
import type {Field, RepeatBinding, Schema, UiLocator, WorkflowPlan} from './model.js';
import {EMAIL_PATTERN} from './email-pattern.js';

type Node = ReturnType<typeof parseTemplate>['nodes'][number];
export type ControlRules = {required?: boolean; requiredTrue?: boolean; email?: boolean; minLength?: number; maxLength?: number; min?: number; max?: number; pattern?: string; patterns?: string[]};
type Rule = ControlRules;
export const attribute = (el:TmplAstElement,key:string) => el.attributes.find(a=>a.name.toLowerCase()===key.toLowerCase())?.value;
const stabilityCache=new WeakMap<Project,Map<ts.Declaration,boolean>>();
/** A const binding does not freeze its value. Follow source aliases before using a complete literal set. */
function aliasedValueIsWritten(project:Project,seed:ts.Declaration,initialWrite?:ts.Node):boolean{
  let cache=stabilityCache.get(project);if(!cache){cache=new Map();stabilityCache.set(project,cache);}if(cache.has(seed))return cache.get(seed)!;
  const aliases=new Set<ts.Declaration>([seed]),introductions=new Set<ts.Node>();
  function denotes(node:ts.Expression):boolean{
    if(ts.isParenthesizedExpression(node)||ts.isAsExpression(node)||ts.isSatisfiesExpression(node)||ts.isNonNullExpression(node))return denotes(node.expression);
    const declaration=project.declaration(node);if(declaration&&aliases.has(declaration))return true;
    if(ts.isPropertyAccessExpression(node)||ts.isElementAccessExpression(node))return denotes(node.expression);
    if(ts.isCallExpression(node)&&!node.arguments.length)return denotes(node.expression);
    if(ts.isArrayLiteralExpression(node))return node.elements.some(element=>ts.isSpreadElement(element)&&denotes(element.expression));
    if(ts.isObjectLiteralExpression(node))return node.properties.some(property=>ts.isPropertyAssignment(property)&&denotes(property.initializer)||ts.isShorthandPropertyAssignment(property)&&denotes(property.name));
    return false;
  }
  let changed=true;
  while(changed){changed=false;const add=(declaration:ts.Declaration|undefined)=>{if(declaration&&!aliases.has(declaration)){aliases.add(declaration);changed=true;}};
    const collect=(node:ts.Node)=>{
      if((ts.isVariableDeclaration(node)||ts.isPropertyDeclaration(node))&&node.initializer&&denotes(node.initializer))add(node);
      if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken&&denotes(node.right)&&!denotes(node.left)){const declaration=project.declaration(node.left);if(declaration){introductions.add(node);add(declaration);}}
      ts.forEachChild(node,collect);
    };for(const file of project.files)collect(file);
  }
  let mutable=false;
  const inspect=(node:ts.Node)=>{
    if(node===initialWrite||introductions.has(node))return;
    if(ts.isBinaryExpression(node)&&node.operatorToken.kind>=ts.SyntaxKind.FirstAssignment&&node.operatorToken.kind<=ts.SyntaxKind.LastAssignment&&denotes(node.left))mutable=true;
    if((ts.isPrefixUnaryExpression(node)||ts.isPostfixUnaryExpression(node))&&[ts.SyntaxKind.PlusPlusToken,ts.SyntaxKind.MinusMinusToken].includes(node.operator)&&denotes(node.operand))mutable=true;
    if(ts.isCallExpression(node)){
      if(ts.isPropertyAccessExpression(node.expression)&&denotes(node.expression.expression)&&['push','pop','shift','unshift','splice','sort','reverse','fill','copyWithin','set','update'].includes(node.expression.name.text))mutable=true;
      // Passing a shared value to arbitrary code prevents a complete immutable-source proof.
      if(node.arguments.some(denotes)&&!project.angularFunction(node.expression,'signal'))mutable=true;
    }
    ts.forEachChild(node,inspect);
  };for(const file of project.files)inspect(file);cache.set(seed,mutable);return mutable;
}
function memberIsWritten(cls:ts.ClassDeclaration,root:string,initialWrite?:ts.Node):boolean{
  let mutable=false;
  const refers=(node:ts.Node)=>new RegExp(`^this\\.${root}(?:\\.|\\[|$)`).test(node.getText());
  const visit=(node:ts.Node)=>{
    if(node===initialWrite)return;
    if(ts.isBinaryExpression(node)&&node.operatorToken.kind>=ts.SyntaxKind.FirstAssignment&&node.operatorToken.kind<=ts.SyntaxKind.LastAssignment&&refers(node.left))mutable=true;
    if((ts.isPostfixUnaryExpression(node)||ts.isPrefixUnaryExpression(node))&&[ts.SyntaxKind.PlusPlusToken,ts.SyntaxKind.MinusMinusToken].includes(node.operator)&&refers(node.operand))mutable=true;
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&refers(node.expression.expression)&&['push','pop','shift','unshift','splice','sort','reverse','fill','copyWithin','set','update'].includes(node.expression.name.text))mutable=true;
    ts.forEachChild(node,visit);
  };visit(cls);return mutable;
}
/** A literal field initializer or one unconditional constructor assignment, with no later writes. */
function componentInitializer(project:Project,cls:ts.ClassDeclaration,root:string):ts.Expression|undefined{
  const member=cls.members.find((m):m is ts.PropertyDeclaration=>ts.isPropertyDeclaration(m)&&nameOf(m)===root);
  if(member?.initializer)return memberIsWritten(cls,root)||aliasedValueIsWritten(project,member)?undefined:member.initializer;
  const writes=cls.members.filter(ts.isConstructorDeclaration).flatMap(c=>c.body?.statements??[]).flatMap(statement=>ts.isExpressionStatement(statement)&&ts.isBinaryExpression(statement.expression)&&statement.expression.operatorToken.kind===ts.SyntaxKind.EqualsToken&&statement.expression.left.getText()===`this.${root}`?[statement.expression]:[]);
  return writes.length===1&&!memberIsWritten(cls,root,writes[0])&&(!member||!aliasedValueIsWritten(project,member,writes[0]))?writes[0].right:undefined;
}
function stableExpression(project:Project,node:ts.Expression,seen=new Set<ts.Node>()):ts.Expression|undefined{
  if(seen.has(node))return;const next=new Set(seen).add(node);
  if(ts.isParenthesizedExpression(node)||ts.isAsExpression(node)||ts.isSatisfiesExpression(node)||ts.isNonNullExpression(node))return stableExpression(project,node.expression,next);
  if(ts.isIdentifier(node)){
    const declaration=project.declaration(node);
    if(declaration&&ts.isVariableDeclaration(declaration)&&declaration.initializer){
      if(!(declaration.parent.flags&ts.NodeFlags.Const)||aliasedValueIsWritten(project,declaration))return;
      return stableExpression(project,declaration.initializer,next);
    }
  }
  return node;
}
function stableArray(project:Project,node:ts.Expression):ts.Expression[]|undefined{
  const value=stableExpression(project,node);if(!value||!ts.isArrayLiteralExpression(value))return;
  const result:ts.Expression[]=[];
  for(const element of value.elements){if(ts.isSpreadElement(element)){const spread=stableArray(project,element.expression);if(!spread)return;result.push(...spread);}else result.push(element);}
  return result;
}
/** Literal template bindings may refer to constants on their owning component. Mutable/runtime values stay unknown. */
function templateConstant(project:Project,cls:ts.ClassDeclaration,source:string,seen=new Set<string>()):string|number|boolean|undefined{
  const value=source.trim();
  if(/^(?:true|false)$/.test(value))return value==='true';
  if(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))return Number(value);
  const quoted=/^(['"])([\s\S]*)\1$/.exec(value);if(quoted)return quoted[2];
  const path=/^(?:this\.)?(\w+)((?:\.\w+)*)$/.exec(value);
  if(!path||seen.has(path[1]))return;
  const root=path[1];
  const member=cls.members.find((m):m is ts.PropertyDeclaration=>ts.isPropertyDeclaration(m)&&nameOf(m)===root&&!!m.initializer);
  if(!member?.initializer)return;
  if(memberIsWritten(cls,root)||aliasedValueIsWritten(project,member))return;
  let expression=stableExpression(project,member.initializer);if(!expression)return;
  for(const key of path[2].split('.').filter(Boolean)){const next=project.property(project.object(expression),key);if(!next)return;expression=next;}
  const literal=stableExpression(project,expression);if(!literal)return;
  if(ts.isStringLiteralLike(literal))return literal.text;
  if(ts.isNumericLiteral(literal))return Number(literal.text);
  if(ts.isPrefixUnaryExpression(literal)&&ts.isNumericLiteral(literal.operand)&&[ts.SyntaxKind.MinusToken,ts.SyntaxKind.PlusToken].includes(literal.operator))return (literal.operator===ts.SyntaxKind.MinusToken?-1:1)*Number(literal.operand.text);
  if(literal.kind===ts.SyntaxKind.TrueKeyword||literal.kind===ts.SyntaxKind.FalseKeyword)return literal.kind===ts.SyntaxKind.TrueKeyword;
  if(ts.isIdentifier(literal))return templateConstant(project,cls,literal.text,new Set(seen).add(root));
}

/** Finite widget values supplied by a stable literal component array, including const aliases and readonly settings. */
export function staticTemplateValues(project:Project,cls:ts.ClassDeclaration,source:string):(string|number|boolean)[]|undefined{
  const literal=source.trim();
  if(literal.startsWith('[')){try{const value=JSON.parse(literal);if(Array.isArray(value)&&value.every(v=>typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)))return value;}catch{}return;}
  const match=/^(?:this\.)?(\w+)((?:\.\w+)*)(?:\(\))?$/.exec(source.trim());if(!match)return;
  const initializer=componentInitializer(project,cls,match[1]);if(!initializer)return;
  let init=stableExpression(project,initializer);if(!init)return;
  for(const key of match[2].split('.').filter(Boolean)){const next=project.property(project.object(init),key);if(!next)return;init=next;}
  const known=stableExpression(project,init);if(!known)return;init=known;
  if(ts.isCallExpression(init)&&/^(?:signal)$/.test(init.expression.getText())&&init.arguments.length===1){const argument=stableExpression(project,init.arguments[0]);if(!argument)return;init=argument;}
  const array=stableArray(project,init);if(!array)return;
  const values:(string|number|boolean)[]=[];
  for(const item of array){
    const value=stableExpression(project,item);if(!value)return;
    if(ts.isStringLiteralLike(value)){values.push(value.text);continue;}
    if(ts.isNumericLiteral(value)){values.push(Number(value.text));continue;}
    if(ts.isPrefixUnaryExpression(value)&&ts.isNumericLiteral(value.operand)&&[ts.SyntaxKind.MinusToken,ts.SyntaxKind.PlusToken].includes(value.operator)){values.push((value.operator===ts.SyntaxKind.MinusToken?-1:1)*Number(value.operand.text));continue;}
    if(value.kind===ts.SyntaxKind.TrueKeyword||value.kind===ts.SyntaxKind.FalseKeyword){values.push(value.kind===ts.SyntaxKind.TrueKeyword);continue;}
    const constant=project.string(value);if(constant!==undefined){values.push(constant);continue;}
    return;
  }
  return values;
}

/** Constraints authored on native/template-driven controls, including statically resolved Angular bindings. */
export function templateControlRules(project:Project,cls:ts.ClassDeclaration,el:TmplAstElement):ControlRules{
  const result:ControlRules={};
  const read=(key:string):string|number|boolean|undefined=>{
    const bound=el.inputs.find(input=>input.name.toLowerCase()===key.toLowerCase());
    if(bound){
      if(bound.value instanceof ASTWithSource&&bound.value.ast instanceof LiteralPrimitive){const v=bound.value.ast.value;return typeof v==='string'||typeof v==='number'||typeof v==='boolean'?v:undefined;}
      const value=bound.value instanceof ASTWithSource?bound.value.source:null;return value===null?undefined:templateConstant(project,cls,value);
    }
    return attribute(el,key);
  };
  for(const [attributeName,property]of [['minlength','minLength'],['maxlength','maxLength'],['min','min'],['max','max']] as const){
    const raw=read(attributeName);if(raw===undefined||typeof raw==='boolean'||String(raw).trim()==='')continue;
    const n=Number(raw);if(Number.isFinite(n)&&(property==='min'||property==='max'||Number.isInteger(n)&&n>=0))result[property]=n;
  }
  const required=read('required');if(required!==undefined)result.required=required!==false&&required!=='false';
  if(result.required&&(attribute(el,'type')==='checkbox'||el.name==='mat-checkbox'))result.requiredTrue=true;
  const email=read('email');if(email!==undefined)result.email=email!==false&&email!=='false';
  const pattern=read('pattern');if(typeof pattern==='string'&&pattern.length)result.pattern=pattern;
  return result;
}

/** Multiple enforced validator sets combine by conjunction; an optional unknown bound never overwrites a known one. */
export function mergeControlRules(...sets:(ControlRules|undefined)[]):ControlRules{
  const out:ControlRules={};
  for(const set of sets){if(!set)continue;
    for(const key of ['required','requiredTrue','email'] as const)if(set[key]!==undefined)out[key]=out[key]===true||set[key];
    for(const key of ['minLength','min'] as const)if(set[key]!==undefined)out[key]=out[key]===undefined?set[key]:Math.max(out[key]!,set[key]!);
    for(const key of ['maxLength','max'] as const)if(set[key]!==undefined)out[key]=out[key]===undefined?set[key]:Math.min(out[key]!,set[key]!);
    const patterns=[...new Set([...(out.patterns??[]),...(out.pattern?[out.pattern]:[]),...(set.patterns??[]),...(set.pattern?[set.pattern]:[])])];
    if(patterns.length){out.pattern=patterns.at(-1);if(patterns.length>1)out.patterns=patterns;}
  }
  return out;
}

export function constrainControlSchema(base:Record<string,unknown>,rules:ControlRules|undefined,required:boolean):Schema{
  const r=rules??{};
  if(r.requiredTrue)return {...base,type:'boolean',const:true};
  const result:Record<string,unknown>={...base};
  if(result.type==='string'){
    const checks=[...r.email?[EMAIL_PATTERN]:[],...[...new Set([...(r.patterns??[]),...r.pattern?[r.pattern]:[]])].map(p=>`^(?:${p.replace(/^\^/,'').replace(/\$$/,'')})$`)];
    if(checks.length===1)result.pattern=checks[0];
    else if(checks.length>1)result.allOf=[...Array.isArray(result.allOf)?result.allOf:[],...checks.map(pattern=>({pattern}))];
    const min=Math.max(r.minLength??0,required&&!Array.isArray(result.enum)?1:0);
    if(min)result.minLength=min;
    if(r.maxLength!==undefined)result.maxLength=r.maxLength;
    if(!required&&(r.minLength||checks.length))return {anyOf:[{const:''},result]};
  }else if(result.type==='number'||result.type==='integer'){
    if(r.min!==undefined)result.minimum=r.min;
    if(r.max!==undefined)result.maximum=r.max;
  }
  return result;
}
const children = (node:Node):Node[] => {
  const n=node as unknown as {children?:Node[];branches?:{children:Node[]}[];cases?:{children:Node[]}[];groups?:{children:Node[]}[]};
  return [...n.children??[], ...[...n.branches??[],...n.cases??[],...n.groups??[]].flatMap(b=>b.children)];
};
/** Option lists: static `value=` options are enumerable; bound or looped options only exist at run time. */
export function optionInfo(el:TmplAstElement):{values:string[];dynamic:boolean}{
  const options=allElements(el.children).filter(n=>['option','mat-option','mat-radio-button','mat-button-toggle'].includes(n.name));
  const looped=(nodes:Node[]):boolean=>nodes.some(n=>n.constructor.name==='ForLoopBlock'||(n instanceof TmplAstTemplate&&(n.templateAttrs.some(a=>a.name==='ngFor'||a.name==='ngForOf')||(n.variables.length>0&&!n.templateAttrs.some(a=>a.name==='ngIf'))))||looped(children(n)));
  const bound=options.some(o=>o.inputs.some(i=>['value','ngValue'].includes(i.name)));
  return {values:options.flatMap(o=>{const v=attribute(o,'value');return v===undefined?[]:[v];}),dynamic:looped(el.children)||bound};
}
/**
 * Looped options over a component field initialised with a literal array (`languages = ['en','de']` or
 * `themes = [{ value: 'A', label: 'x' }]`) are known statically. Anything else stays dynamic.
 */
export function resolveLoopOptions(project:Project,cls:ts.ClassDeclaration,el:TmplAstElement):string[]|undefined{
  const tags=['option','mat-option','mat-radio-button','mat-button-toggle'];
  const authored=allElements(el.children).filter(option=>tags.includes(option.name));
  let list:string|undefined;let item:string|undefined;let option:TmplAstElement|undefined;
  let loops=0,unknown=false;
  const find=(nodes:Node[])=>{for(const n of nodes){
    const nested=allElements(children(n)).filter(element=>tags.includes(element.name));
    if(n.constructor.name==='ForLoopBlock'){const l=n as unknown as {item:{name:string};expression:ASTWithSource;children:Node[]};if(nested.length){loops++;if(nested.length!==1)unknown=true;list=l.expression.source??undefined;item=l.item.name;option=nested[0];}}
    else if(n instanceof TmplAstTemplate&&n.templateAttrs.some(a=>a.name==='ngForOf')){const of=n.templateAttrs.find(a=>a.name==='ngForOf') as unknown as {value:ASTWithSource};if(nested.length){loops++;if(nested.length!==1)unknown=true;list=of.value.source??undefined;item=n.variables.find(v=>v.value===''||v.value==='$implicit')?.name;option=nested[0];}}
    else if(nested.length&&!(n instanceof TmplAstElement)&&!(n instanceof TmplAstText))unknown=true;
    find(children(n));
  }};
  find(el.children);
  if(unknown||loops!==1||!list||!item||!option)return;
  const normalize=(value:string)=>value.replace(/[\t\n\f\r ]+/g,' ').replace(/^ | $/g,'');
  const literalSiblings=new Map<TmplAstElement,string>();
  for(const sibling of authored.filter(authored=>authored!==option)){
    const bound=sibling.inputs.find(input=>['value','ngValue'].includes(input.name));
    if(bound){const value=bound.name==='value'&&bound.value instanceof ASTWithSource?templateConstant(project,cls,bound.value.source??''):undefined;if(value===undefined)return;literalSiblings.set(sibling,String(value));continue;}
    const value=attribute(sibling,'value');if(value!==undefined){literalSiblings.set(sibling,value);continue;}
    if(sibling.name!=='option'||sibling.children.some(child=>!(child instanceof TmplAstText)))return;
    literalSiblings.set(sibling,normalize(sibling.children.map(child=>(child as TmplAstText).value).join('')));
  }
  // Native <option> defaults its value to its rendered text when no value binding exists.
  const boundText=option.name==='option'&&option.children.length===1?(option.children[0] as unknown as {value?:unknown}).value:undefined;
  const implicitValue=boundText instanceof ASTWithSource?/^\{\{\s*(\w+(?:\.\w+)?)\s*\}\}$/.exec(boundText.source?.trim()??'')?.[1]:undefined;
  const explicitValue=binding(option,'value')??binding(option,'ngValue');
  const valueExpr=explicitValue??(attribute(option,'value')===undefined?implicitValue:undefined);
  if(!valueExpr)return;
  const prop=valueExpr===item?undefined:new RegExp(`^${item}\\.(\\w+)$`).exec(valueExpr)?.[1];
  if(valueExpr!==item&&!prop)return;
  const name=/^(?:this\.)?(\w+)$/.exec(list)?.[1];
  const initializer=name?componentInitializer(project,cls,name):undefined;if(!initializer)return;
  let init=stableExpression(project,initializer);if(!init)return;
  if(ts.isCallExpression(init)&&init.arguments.length===1&&/^(signal|computed)$/.test(init.expression.getText()))init=stableExpression(project,init.arguments[0]);
  if(!init)return;const array=stableArray(project,init);if(!array||!array.length)return;
  const values:string[]=[];
  for(const e of array){
    const known=stableExpression(project,e);if(!known)return;
    if(prop){const o=project.object(known);const v=project.string(project.property(o,prop));if(v===undefined)return;values.push(v);}
    else{const v=project.string(known);if(v===undefined)return;values.push(v);}
  }
  const loopValues=explicitValue===undefined&&implicitValue?values.map(normalize):values;
  // A restrictive enum is safe only for the complete authored set, including known placeholder/literal siblings.
  return [...new Set(authored.flatMap(authored=>authored===option?loopValues:[literalSiblings.get(authored)!]))];
}
export function allElements(nodes:Node[]):TmplAstElement[]{return nodes.flatMap(n=>[...n instanceof TmplAstElement?[n]:[],...allElements(children(n))]);}
const text = (node:Node):string => node instanceof TmplAstText ? node.value : children(node).map(text).join(' ');
const expression = (value:unknown):string|undefined => value instanceof ASTWithSource ? value.source??undefined : undefined;
const binding = (node:TmplAstElement,key:string) => expression(node.inputs.find(i=>i.name===key)?.value);
const loop = (node:Node):node is Node & {item:{name:string};expression:ASTWithSource;children:Node[]} => node.constructor.name==='ForLoopBlock';
const plainSelector = (node:TmplAstElement) => {
  const id=attribute(node,'id');if(id&&/^[a-zA-Z][\w-]*$/.test(id))return `${node.name}#${id}`;
  const classes=attribute(node,'class')?.split(/\s+/).filter(c=>/^[a-zA-Z_][\w-]*$/.test(c));
  return node.name+(classes?.length?'.'+classes.join('.'):'');
};

export function fieldRules(project:Project,cls:ts.ClassDeclaration):Map<string,Rule>{
  const rules=new Map<string,Rule>();
  const number=(node?:ts.Expression):number|undefined=>{if(!node)return;const v=project.unwrap(node);return ts.isNumericLiteral(v)?Number(v.text):undefined;};
  const path=(node:ts.Expression,env:Map<string,string>)=>{
    const parts=node.getText().split('.');const prefix=env.get(parts.shift()!);return prefix===undefined?undefined:[prefix,...parts].filter(Boolean).join('.');
  };
  function visit(node:ts.Node,env=new Map<string,string>()){
    if(ts.isCallExpression(node)){
      const callee=node.expression.getText().split('.').at(-1);
      if(callee==='form'&&node.arguments[1]&&ts.isArrowFunction(node.arguments[1])){
        const callback=node.arguments[1];const alias=callback.parameters[0];
        if(alias)visit(callback.body,new Map(env).set(alias.name.getText(),''));
      }
      if(callee==='applyEach'&&node.arguments[0]&&node.arguments[1]&&ts.isArrowFunction(node.arguments[1])){
        const p=path(node.arguments[0],env);const callback=node.arguments[1];const alias=callback.parameters[0];
        if(p&&alias)visit(callback.body,new Map(env).set(alias.name.getText(),p));return;
      }
      if(['required','minLength','maxLength'].includes(callee??'')&&node.arguments[0]){
        const p=path(node.arguments[0],env);
        if(p){const rule=rules.get(p)??{};if(callee==='required')rule.required=true;else{const n=number(node.arguments[1]);if(n!==undefined)rule[callee as 'minLength'|'maxLength']=n;}rules.set(p,rule);}
      }
    }
    ts.forEachChild(node,n=>visit(n,env));
  }
  visit(cls);return rules;
}

export function controls(project:Project,cls:ts.ClassDeclaration,nodes:Node[]){
  const rules=fieldRules(project,cls);const fields:Field[]=[];const repeats:RepeatBinding[]=[];const issues:string[]=[];
  function makeField(el:TmplAstElement,ancestors:TmplAstElement[],prefix=''):Field|undefined{
    const signal=binding(el,'formField');const name=attribute(el,'formControlName')??attribute(el,'name')??signal?.split('.').at(-1)??binding(el,'ngModel')?.split('.').at(-1);
    if(!name)return;
    const parent=[...ancestors].reverse().find(p=>p.name==='mat-form-field');
    const label=parent?.children.filter((n):n is TmplAstElement=>n instanceof TmplAstElement&&n.name==='mat-label').map(text).join(' ').trim();
    const type=attribute(el,'type')??'text';
    const adapter:Field['adapter']=el.name==='quill-editor'?'contenteditable':el.name==='mat-select'?'material-select':el.name==='mat-checkbox'?'material-checkbox':el.name==='mat-slide-toggle'?'material-toggle':['mat-radio-group','mat-button-toggle-group'].includes(el.name)?'material-choice':el.inputs.some(i=>i.name==='matDatepicker')?'datepicker':'native';
    const options=allElements(el.children).filter(n=>['option','mat-option','mat-radio-button','mat-button-toggle'].includes(n.name)).flatMap(n=>{const value=attribute(n,'value');return value===undefined?[]:[{value,label:text(n).trim()}];});
    // Rules are keyed by path from the form root: a nested binding `form.address.street` is `address.street`.
    const ruleKey=prefix?[prefix,name].join('.'):signal&&signal.includes('.')?signal.split('.').slice(1).join('.'):name;
    const rule=mergeControlRules(rules.get(ruleKey)??rules.get([prefix,name].filter(Boolean).join('.')),templateControlRules(project,cls,el));
    const schema:Record<string,unknown>=adapter==='material-checkbox'||adapter==='material-toggle'||type==='checkbox'?{type:'boolean'}:type==='number'?{type:'number'}:{type:'string'};
    const info=optionInfo(el);
    const resolved=info.dynamic?resolveLoopOptions(project,cls,el):undefined;
    if(resolved){info.values=resolved;info.dynamic=false;options.splice(0,options.length,...resolved.map(v=>({value:v,label:v})));}
    if(options.length&&!info.dynamic)schema.enum=options.map(o=>o.value).filter(v=>!(rule.required&&v===''));
    if(type==='password')schema.writeOnly=true;
    if(adapter==='material-select'&&(!options.length||info.dynamic))schema.description='The visible option label in the current application.';
    const selector=attribute(el,'formControlName')!==undefined?`${el.name}[formcontrolname=${JSON.stringify(name)}]`:attribute(el,'name')!==undefined?`${el.name}[name=${JSON.stringify(name)}]`:plainSelector(el);
    const supported=(['input','textarea','select','mat-select','mat-checkbox','mat-slide-toggle','mat-radio-group','mat-button-toggle-group','quill-editor'].includes(el.name)&&!['file','hidden','radio'].includes(type))&&(!signal||!!label);
    if(!supported)issues.push(`Control ${prefix?prefix+'.':''}${name} requires an unsupported widget or locator`);
    const dynamicOptions=['mat-select','select'].includes(el.name)&&(!options.length||info.dynamic);
    return {name,selector,element:el.name,type,required:!!rule.required,supported,schema:constrainControlSchema(schema,rule,!!rule.required),adapter,...dynamicOptions?{dynamicOptions}:{},...label?{label}:{},...options.length?{options}:{}};
  }
  function walk(current:Node[],ancestors:TmplAstElement[]=[],destination=fields,prefix=''){
    for(const node of current){
      if(loop(node)){
        const expr=expression(node.expression)??'';
        const elements=allElements(node.children);
        if(elements.some(el=>binding(el,'formField')?.startsWith(node.item.name+'.'))){
          const name=expr.split('.').at(-1)!;const row=node.children.find((n):n is TmplAstElement=>n instanceof TmplAstElement);
          if(!row){issues.push(`Repeated field ${name} has no stable row element`);continue;}
          const itemFields:Field[]=[];walk(node.children,[],itemFields,name);
          const methods=cls.members.filter(ts.isMethodDeclaration);
          const addMethods=methods.filter(m=>{
            let collection=false,append=false;
            const scan=(n:ts.Node)=>{if(ts.isPropertyAccessExpression(n)&&n.name.text===name)collection=true;if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&['push','update'].includes(n.expression.name.text))append=true;ts.forEachChild(n,scan);};scan(m);return collection&&append;
          }).map(nameOf);
          const removeMethods=methods.filter(m=>m.getText().includes(`.${name}`)&&/\.filter\(|\.removeAt\(/.test(m.getText())).map(nameOf);
          const add=allElements(nodes).filter(el=>el.outputs.some(o=>o.name==='click'&&addMethods.some(m=>expression(o.handler)===`${m}()`)));
          const remove=elements.find(el=>el.outputs.some(o=>o.name==='click'&&removeMethods.some(m=>expression(o.handler)?.startsWith(`${m}(`))));
          if(add.length!==1){issues.push(`Repeated field ${name} needs exactly one add-row UI action`);continue;}
          const addLocator=locator(add[0],nodes);
          repeats.push({name,rowSelector:plainSelector(row),fields:itemFields,add:addLocator,...remove?{remove:{selector:plainSelector(remove)}}:{},maxItems:100});
          continue;
        }
      }
      if(node instanceof TmplAstElement){const field=makeField(node,ancestors,prefix);if(field)destination.push(field);walk(node.children,[...ancestors,node],destination,prefix);}
      else walk(children(node),ancestors,destination,prefix);
    }
  }
  walk(nodes);
  for(const group of [fields,...repeats.map(r=>r.fields)])if(new Set(group.map(f=>f.name)).size!==group.length)issues.push('Duplicate form field names need a more specific scope');
  return {fields,repeats,issues,rules};
}

/** Derive selectors from the authored element and its static template ancestors. */
export function locator(node:TmplAstElement,nodes:Node[]):UiLocator{
  const parents=new Map<Node,TmplAstElement>();
  function walk(list:Node[],parent?:TmplAstElement){for(const n of list){if(parent)parents.set(n,parent);walk(children(n),n instanceof TmplAstElement?n:parent);}}walk(nodes);
  const base=plainSelector(node);const all=allElements(nodes);
  const wantedClasses=(attribute(node,'class')??'').split(/\s+/).filter(Boolean);
  const same=all.filter(n=>n.name===node.name&&(!attribute(node,'id')||attribute(n,'id')===attribute(node,'id'))&&wantedClasses.every(c=>(attribute(n,'class')??'').split(/\s+/).includes(c)));
  if(same.length===1)return {selector:base};
  const type=attribute(node,'type');if(type&&same.filter(n=>attribute(n,'type')===type).length===1)return {selector:`${base}[type=${JSON.stringify(type)}]`};
  let parent=parents.get(node);
  while(parent){const p=plainSelector(parent);if(p!==parent.name||parents.get(parent)===undefined)return {selector:`${p} ${base}`,label:text(node).replace(/\s+/g,' ').trim()};parent=parents.get(parent);}
  return {selector:base,label:text(node).replace(/\s+/g,' ').trim()};
}

export function schemaForControls(fields:Field[],repeats:RepeatBinding[],rules=new Map<string,Rule>(),partial=false):Schema{
  const properties:Record<string,Schema>=Object.fromEntries(fields.filter(f=>f.supported).map(f=>[f.name,f.schema]));
  for(const repeat of repeats){const rule=rules.get(repeat.name);properties[repeat.name]={type:'array',minItems:rule?.minLength??0,maxItems:Math.min(rule?.maxLength??repeat.maxItems,repeat.maxItems),items:schemaForControls(repeat.fields,[])};}
  return {type:'object',properties,required:partial?[]:[...fields.filter(f=>f.required&&f.supported).map(f=>f.name),...repeats.map(r=>r.name)],additionalProperties:false};
}

export function localFormEffects(project:Project,cls:ts.ClassDeclaration):{form:string;effect:NonNullable<WorkflowPlan['effect']>}[]{
  const result:{form:string;effect:NonNullable<WorkflowPlan['effect']>}[]=[];
  const visit=(node:ts.Node)=>{
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='subscribe'){
      let form:string|undefined;
      const find=(n:ts.Node)=>{if(ts.isPropertyAccessExpression(n)&&n.name.text==='valueChanges'&&ts.isPropertyAccessExpression(n.expression)&&n.expression.expression.kind===ts.SyntaxKind.ThisKeyword)form=n.expression.name.text;ts.forEachChild(n,find);};find(node.expression.expression);
      const callback=node.arguments[0];
      if(form&&callback){const scan=(n:ts.Node)=>{
        if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='setItem'&&n.expression.expression.getText()==='localStorage'){
          const global=project.symbol(n.expression.expression)?.declarations?.some(d=>d.getSourceFile().fileName.endsWith('/lib.dom.d.ts'));
          const key=project.string(n.arguments[0]);if(global&&key)result.push({form:form!,effect:{kind:'local-storage',key,source:project.ref(n)}});
        }ts.forEachChild(n,scan);
      };scan(callback);}
    }ts.forEachChild(node,visit);
  };visit(cls);return result;
}

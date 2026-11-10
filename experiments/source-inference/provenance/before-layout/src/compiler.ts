import ts from 'typescript';
import { parseTemplate, ASTWithSource, Call, PropertyRead, ImplicitReceiver, TmplAstElement, TmplAstTemplate, RecursiveAstVisitor } from '@angular/compiler';
import { resolve } from 'node:path';
import { Project, hash, nameOf, publicMethod, type SourceCallable } from './project.js';
import { SchemaCompiler } from './schema.js';
import {handlerConstraints,constrainHandlerInput} from './handler-constraints.js';
import {staticTemplateValues} from './workflow-compiler.js';
import {counterWidget} from './counter-compiler.js';
import {matchingComponents} from './template-components.js';
import {wrappedControls} from './wrapped-controls.js';
import {scalarModelFields} from './scalar-model-workflow.js';
import {inlineReveal} from './inline-reveal.js';
import {nativeSubmit} from './native-submit.js';
import {textEventWorkflow,trackedDisplayIdentity} from './event-workflows.js';
import {staticRouterLinks} from './router-links.js';
import {nonblankValidator} from './validator-constraints.js';
import {resolveTemplateCallbacks} from './template-callbacks.js';
import {hostInputsFor,foldHostInput,type HostInputs} from './host-context.js';
import {projectedTarget} from './projected-target.js';
import type { Capability, Diagnostic, Field, Manifest, Schema } from './model.js';
import {allElements,controls,localFormEffects,locator,optionInfo,resolveLoopOptions,schemaForControls,templateControlRules,mergeControlRules,constrainControlSchema,type ControlRules} from './workflow-compiler.js';

type Scope = { path: string; guards: string[]; providers: Map<ts.ClassDeclaration, ts.ClassDeclaration>; uncertain: boolean };
type RouteComponent = Scope & { component: ts.ClassDeclaration };
type HtmlNode = ReturnType<typeof parseTemplate>['nodes'][number];

const routeParamsOf = (path: string) => [...path.matchAll(/:([A-Za-z_]\w*)/g)].map(m => m[1]);
function withRouteParams(schema: Schema, params: string[], target?: Capability['target']): Schema {
  if (!params.length || typeof schema !== 'object') return schema;
  const o = schema as { properties?: Record<string, Schema>; required?: string[] };
  const own = Object.fromEntries(params.map(p => [p, (p===target?.param&&target.inputSchema?typeof target.inputSchema==='object'&&target.inputSchema.type==='string'&&/^_?id$/i.test(target.path.at(-1)??'')?{...target.inputSchema,minLength:1}:target.inputSchema:target?.integer && p === target.param ? { type: 'integer', minimum: target.minimum ?? 0 } : { type: 'string', minLength: 1, pattern: '^(?!\\.\\.?$)[^/?#]+$' }) as Schema]));
  return { ...o, properties: { ...own, ...o.properties }, required: [...params, ...(o.required ?? []).filter(r => !params.includes(r))] };
}

export function compile(config: string, entry: string): Manifest {
  const project = new Project(config);
  const diagnostics: Diagnostic[] = [];
  const routes: RouteComponent[] = [];
  const layoutChildren=new Map<string,Set<string>>();
  const capabilities: Capability[] = [];
  const warn = (code: string, message: string, node?: ts.Node) => diagnostics.push({ code, message, ...(node ? { source: project.ref(node) } : {}) });
  const selectors = new Map<string, ts.ClassDeclaration[]>();
  for (const cls of project.classes) {
    const selector = project.string(project.property(project.metadata(cls, 'Component'), 'selector'));
    if (selector) selectors.set(selector, [...selectors.get(selector) ?? [], cls]);
  }

  function providers(node: ts.Expression | undefined, scope: Scope, ancestors=new Set<ts.Node>()): Scope {
    const result = { ...scope, providers: new Map(scope.providers) };
    if (!node) return result;
    const value=project.unwrap(node);
    if(ancestors.has(value))return {...result,uncertain:true};
    const next=new Set(ancestors).add(value);
    // The contents of a provider array may be imported or nested, but must be statically inspectable.
    if(ts.isCallExpression(value)&&project.angularFunction(value.expression,'importProvidersFrom')){
      let current:Scope=result;
      const seenModules=new Set<ts.ClassDeclaration>();
      const data=(expression:ts.Expression,seen=new Set<ts.Node>()):boolean=>{
        if(seen.has(expression))return false;const stack=new Set(seen).add(expression);
        const n=project.unwrap(expression);
        if(ts.isStringLiteralLike(n)||ts.isNumericLiteral(n)||[ts.SyntaxKind.TrueKeyword,ts.SyntaxKind.FalseKeyword,ts.SyntaxKind.NullKeyword].includes(n.kind))return true;
        if(ts.isArrayLiteralExpression(n))return n.elements.every(e=>data(ts.isSpreadElement(e)?e.expression:e,stack));
        if(ts.isObjectLiteralExpression(n))return n.properties.every(p=>ts.isPropertyAssignment(p)&&!['provide','useFactory','useClass','useExisting'].includes(nameOf(p))&&data(p.initializer,stack));
        const d=project.declaration(n);
        // Library data constants cannot carry an application token that the library cannot import.
        return !!d&&d.getSourceFile().fileName.includes('/node_modules/')&&d.getSourceFile().isDeclarationFile&&!ts.isClassDeclaration(d)&&!project.checker.getTypeAtLocation(n).getCallSignatures().length&&!project.checker.getTypeAtLocation(n).getConstructSignatures().length;
      };
      const module=(expression:ts.Expression):void=>{
        const e=project.unwrap(expression);
        if(ts.isArrayLiteralExpression(e)){for(const element of e.elements)module(ts.isSpreadElement(element)?element.expression:element);return;}
        const call=ts.isCallExpression(e)&&ts.isPropertyAccessExpression(e.expression)?e:undefined;
        const cls=project.classAt(call?(call.expression as ts.PropertyAccessExpression).expression:e);
        if(!cls){current={...current,uncertain:true};return;}
        if(cls.getSourceFile().isDeclarationFile&&cls.getSourceFile().fileName.includes('/node_modules/')&&cls.members.some(member=>nameOf(member)==='ɵmod')&&(!call||call.arguments.every(argument=>data(argument))))return;
        if(call){current={...current,uncertain:true};return;}
        const meta=project.metadata(cls,'NgModule');
        if(!meta||next.has(cls)){current={...current,uncertain:true};return;}
        if(seenModules.has(cls))return;seenModules.add(cls);
        current=providers(project.property(meta,'providers'),current,new Set(next).add(cls));
        for(const imported of project.array(project.property(meta,'imports'))??[])module(imported);
      };
      for(const argument of value.arguments)module(argument);
      return current;
    }
    const items = project.array(node);
    if (!items) return { ...result, uncertain: true };
    for (const item of items) {
      const nested=project.unwrap(item);
      if(ts.isArrayLiteralExpression(nested)||ts.isCallExpression(nested)&&project.angularFunction(nested.expression,'importProvidersFrom')){
        const resolved=providers(item,result,next);result.providers=resolved.providers;result.uncertain=resolved.uncertain;continue;
      }
      const direct = project.classAt(item);
      if (direct) { result.providers.set(direct, direct); continue; }
      if(project.injectableFactoryAt(item))continue;
      const obj = project.object(item);
      // Forms plumbing (value accessors/validators) never changes which service an injected field resolves to.
      if (/^(NG_VALUE_ACCESSOR|NG_VALIDATORS|NG_ASYNC_VALIDATORS)$/.test(project.property(obj, 'provide')?.getText() ?? '')) continue;
      const token = project.classAt(project.property(obj, 'provide'));
      const impl = project.classAt(project.property(obj, 'useClass'));
      if (token && impl) result.providers.set(token, impl);
      else if(project.injectableFactoryAt(project.property(obj,'provide')))result.uncertain=true;
      else if (!token && project.property(obj,'useValue')) continue;
      else result.uncertain = true;
    }
    return result;
  }

  function lazyTarget(expression: ts.Expression): ts.Expression | undefined {
    expression = project.unwrap(expression);
    let result: ts.Expression | undefined;
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAccessExpression(node) && project.declaration(node)) {
        const d = project.declaration(node);
        if (d && (ts.isClassDeclaration(d) || ts.isVariableDeclaration(d))) result = node;
      }
      ts.forEachChild(node, visit);
    };
    visit(expression);
    if (!result && (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression))) {
      const body = expression.body;
      if (ts.isCallExpression(body) && body.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const module = project.symbol(body.arguments[0]);
        const exported = module && project.checker.getExportsOfModule(module).find(s => s.name === 'default');
        const declaration = exported?.valueDeclaration ?? exported?.declarations?.[0];
        if (declaration && ts.isClassDeclaration(declaration) && declaration.name) result = declaration.name;
        if (declaration && ts.isExportAssignment(declaration)) result = declaration.expression;
      }
    }
    return result;
  }

  const walked = new Set<string>();
  function walkRoutes(expression: ts.Expression, scope: Scope, stack = new Set<ts.Node>()) {
    const value = project.unwrap(expression);
    if (stack.has(value)) { warn('route-cycle', 'Cyclic route/module graph', value); return; }
    // Shared modules reachable along many paths would otherwise be walked once per path (exponential in diamond graphs).
    const visitKey = `${scope.path}|${scope.guards.join(',')}|${[...scope.providers].map(([k, v]) => `${k.pos}>${v.pos}`).join(',')}|${scope.uncertain}|${value.getSourceFile().fileName}:${value.pos}`;
    if (walked.has(visitKey)) return;
    walked.add(visitKey);
    const next = new Set(stack).add(value);
    const cls = project.classAt(value);
    if (cls) {
      const meta = project.metadata(cls, 'NgModule');
      if (!meta) { warn('unsupported-lazy-module', 'Lazy target is not a statically known NgModule', cls); return; }
      const scoped = providers(project.property(meta, 'providers'), scope);
      for (const imported of project.array(project.property(meta, 'imports')) ?? []) {
        const unwrapped = project.unwrap(imported);
        if (ts.isCallExpression(unwrapped) && ts.isPropertyAccessExpression(unwrapped.expression) && ['forRoot', 'forChild'].includes(unwrapped.expression.name.text)) {
          if (unwrapped.arguments[0]) walkRoutes(unwrapped.arguments[0], scoped, next);
        } else if (project.metadata(project.classAt(unwrapped) ?? cls, 'NgModule')) {
          // Only route-containing imports matter; static module cycles are bounded.
          const importedClass = project.classAt(unwrapped);
          if (importedClass) walkRoutes(unwrapped, scoped, next);
        }
      }
      return;
    }
    const array = project.array(value);
    if (!array) { warn('dynamic-routes', 'Route expression could not be resolved statically', value); return; }
    for (const item of array) {
      const object = project.object(item);
      if (!object) { warn('dynamic-route', 'Skipping a dynamic route', item); continue; }
      const path = project.string(project.property(object, 'path'));
      if (path === undefined) { warn('dynamic-path', 'Skipping a route without a static path', item); continue; }
      if (project.property(object, 'redirectTo')) continue;
      const full = '/' + [scope.path, path].join('/').split('/').filter(Boolean).join('/');
      const guardNames = ['canActivate', 'canActivateChild', 'canMatch'].flatMap(key => (project.array(project.property(object, key)) ?? []).map(g => g.getText()));
      const current = providers(project.property(object, 'providers'), { ...scope, path: full, guards: [...scope.guards, ...guardNames] });
      let component = project.classAt(project.property(object, 'component'));
      const loadComponent = project.property(object, 'loadComponent');
      if (loadComponent) component = project.classAt(lazyTarget(loadComponent));
      if (component) routes.push({ ...current, component });
      const childStart=routes.length;
      const children = project.property(object, 'children');
      if (children) walkRoutes(children, current, next);
      const loadChildren = project.property(object, 'loadChildren');
      if (loadChildren) {
        const target = lazyTarget(loadChildren);
        if (target) walkRoutes(target, current, next);
        else warn('dynamic-lazy-route', 'Lazy import did not resolve to a route array or module', loadChildren);
      }
      if(component&&(children||loadChildren)){const known=layoutChildren.get(full)??new Set<string>();for(const child of routes.slice(childStart))known.add(child.path);layoutChildren.set(full,known);}
    }
  }

  const [file, symbolName = 'routes'] = entry.split('#');
  const source = project.program.getSourceFile(resolve(project.root, file));
  if (!source) throw new Error(`Route file is not part of the TypeScript program: ${file}`);
  let root: ts.Expression | undefined;
  const find = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && nameOf(node) === symbolName && node.initializer) root = node.initializer;
    if (ts.isClassDeclaration(node) && nameOf(node) === symbolName && node.name) root = node.name;
    ts.forEachChild(node, find);
  };
  find(source);
  if (!root) throw new Error(`Cannot find route entry ${entry}`);
  walkRoutes(root, { path: '', guards: [], providers: new Map(), uncertain: false });

  function injected(cls: ts.ClassDeclaration) {
    const result = new Map<string, ts.ClassDeclaration|ts.VariableDeclaration>();
    for (const member of cls.members) {
      if (ts.isConstructorDeclaration(member)) {
        for (const p of member.parameters) {
          if (!p.modifiers?.some(m => [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.PublicKeyword, ts.SyntaxKind.ProtectedKeyword, ts.SyntaxKind.ReadonlyKeyword].includes(m.kind))) continue;
          const symbol = project.checker.getTypeAtLocation(p).getSymbol();
          const declaration = symbol?.valueDeclaration;
          if (declaration && ts.isClassDeclaration(declaration)) result.set(nameOf(p), declaration);
          const explicit=(ts.getDecorators(p)??[]).find(d=>ts.isCallExpression(d.expression)&&project.angularFunction(d.expression.expression,'Inject'));
          if(explicit&&ts.isCallExpression(explicit.expression)){
            const token=project.classAt(explicit.expression.arguments[0])??project.injectableFactoryAt(explicit.expression.arguments[0]);
            if(token)result.set(nameOf(p),token);
          }
        }
      }
      if (ts.isPropertyDeclaration(member) && member.initializer && ts.isCallExpression(member.initializer) && project.angularFunction(member.initializer.expression, 'inject')) {
        const token = project.classAt(member.initializer.arguments[0])??project.injectableFactoryAt(member.initializer.arguments[0]);
        if (token) result.set(nameOf(member), token);
      }
    }
    return result;
  }

  function trace(cls: ts.ClassDeclaration, handler: ts.MethodDeclaration | ts.PropertyDeclaration, scope: Scope, direct?:{receiver:string;method:string;arguments:string[]}) {
    const dependencies = injected(cls);
    const bindings: Capability['bindings'] = [];
    const paths: string[][] = [];
    const confirmation: string[] = [];
    let stateful = false;
    const visited = new Set<ts.Node>();
    function bind(receiver:string,methodName:string,args:string[],path:string[]){
      const token=dependencies.get(receiver);
      const implementation=token&&(ts.isClassDeclaration(token)?scope.providers.get(token)??token:token);
      const target:SourceCallable|undefined=token&&implementation&&(ts.isVariableDeclaration(token)
        ?project.factoryMethod(token,methodName)
        :ts.isClassDeclaration(implementation)&&project.isService(token)&&!implementation.getSourceFile().isDeclarationFile
          ?implementation.members.find((m):m is ts.MethodDeclaration=>publicMethod(m)&&nameOf(m)===methodName):undefined);
      if(!target)return;
      const schemas=new SchemaCompiler(project.checker).method(target);
      const paramKeys:Record<string,string>={};
      const scanKeys=(node:ts.Node)=>{
        if(ts.isPropertyAssignment(node)&&ts.isIdentifier(node.initializer)&&target.parameters.some(p=>ts.isIdentifier(p.name)&&p.name.text===(node.initializer as ts.Identifier).text))paramKeys[node.initializer.text]=nameOf(node);
        if(ts.isShorthandPropertyAssignment(node)&&target.parameters.some(p=>ts.isIdentifier(p.name)&&p.name.text===node.name.text))paramKeys[node.name.text]=node.name.text;
        ts.forEachChild(node,scanKeys);
      };
      if(target.body)scanKeys(target.body);
      const binding={...(Object.keys(paramKeys).length?{paramKeys}:{}),token:nameOf(token!),service:nameOf(implementation!),method:methodName,source:project.ref(target),arguments:args,inputSchema:schemas.inputSchema,outputSchema:schemas.outputSchema,schemaIssues:[...new Set(schemas.issues)]};
      if(!bindings.some(b=>b.source.file===binding.source.file&&b.source.line===binding.source.line&&b.method===methodName))bindings.push(binding);
      paths.push([...path,`${nameOf(implementation!)}.${methodName}`]);
    }
    function method(current: ts.MethodDeclaration | ts.PropertyDeclaration, path: string[]) {
      if (visited.has(current)) return;
      visited.add(current);
      const visit = (node: ts.Node) => {
        // Component state written by the handler: this.x = ..., this.x.set/update/next(...), form patches.
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && node.left.getText().startsWith('this.')) stateful = true;
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ['set', 'update', 'next', 'emit', 'patchValue', 'setValue', 'reset', 'toggle'].includes(node.expression.name.text) && node.expression.expression.getText().startsWith('this.')) stateful = true;
        if (ts.isCallExpression(node)) {
          const callee = node.expression;
          if (ts.isPropertyAccessExpression(callee)) {
            if (callee.name.text === 'confirm' || callee.name.text === 'fire' && /Swal|swal/.test(callee.expression.getText())) confirmation.push(node.getText().slice(0, 240));
            if (callee.expression.kind === ts.SyntaxKind.ThisKeyword) {
              const helper = project.declaration(callee.name);
              if (helper && ts.isMethodDeclaration(helper) && helper.parent === cls) method(helper, [...path, `${nameOf(cls)}.${nameOf(helper)}`]);
            }
            if (ts.isPropertyAccessExpression(callee.expression) && callee.expression.expression.kind === ts.SyntaxKind.ThisKeyword) {
              const token = dependencies.get(callee.expression.name.text);
              // NgRx: `this.store.dispatch(action(...))` is the operation; effects run it elsewhere.
              if (token && nameOf(token) === 'Store' && token.getSourceFile().isDeclarationFile && callee.name.text === 'dispatch') {
                const ref = project.ref(node);
                const binding = { token: 'Store', service: 'Store', method: 'dispatch', source: ref, arguments: node.arguments.map(a => a.getText()), inputSchema: { type: 'object' } as Schema, outputSchema: true as Schema, schemaIssues: [] };
                if (!bindings.some(b => b.source.file === ref.file && b.source.line === ref.line)) bindings.push(binding);
                paths.push([...path, `Store.dispatch(${node.arguments[0]?.getText().slice(0, 60) ?? ''})`]);
              }
              if (token && nameOf(token) === 'HttpClient' && token.getSourceFile().isDeclarationFile && ['get', 'post', 'put', 'patch', 'delete'].includes(callee.name.text)) {
                const ref = project.ref(node);
                const binding = { token: 'HttpClient', service: 'HttpClient', method: callee.name.text, source: ref, arguments: node.arguments.map(a => a.getText()), inputSchema: { type: 'object' } as Schema, outputSchema: true as Schema, schemaIssues: [] };
                if (!bindings.some(b => b.source.file === ref.file && b.source.line === ref.line)) bindings.push(binding);
                paths.push([...path, `HttpClient.${callee.name.text}`]);
              }
              // The receiver is proven injected; factory methods still resolve to their authored source declarations.
              bind(callee.expression.name.text,callee.name.text,node.arguments.map(a=>a.getText()),path);
            }
          } else if (ts.isIdentifier(callee) && callee.text === 'confirm') confirmation.push(node.getText());
        }
        ts.forEachChild(node, visit);
      };
      const body = ts.isMethodDeclaration(current) ? current.body : current.initializer;
      if (body) visit(body);
    }
    if(direct){
      bind(direct.receiver,direct.method,direct.arguments,[`${nameOf(cls)}.${direct.receiver}.${direct.method}`]);
      // A resource reload reruns the checked initializer's query, rather than invoking an injected store method.
      if(!bindings.length&&direct.method==='reload'&&ts.isPropertyDeclaration(handler))method(handler,[`${nameOf(cls)}.${direct.receiver}.reload`]);
    }
    else method(handler, [`${nameOf(cls)}.${nameOf(handler)}`]);
    return { bindings, paths, confirmation, stateful };
  }

  type Rules = ControlRules;
  // Reads Validators.* (including conditional spreads such as `...(!this.id ? [Validators.required] : [])`) from the FormBuilder definition.
  function formRules(cls: ts.ClassDeclaration, formName: string, hasRouteParam: boolean): Map<string, Rules> {
    const result = new Map<string, Rules>();
    const routeFields = new Set<string>();
    const scanFields = (n: ts.Node) => {
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && n.left.getText().startsWith('this.') && /snapshot\.(params|paramMap)|\.params\b|paramMap/.test(n.right.getText())) routeFields.add(n.left.getText().slice(5));
      ts.forEachChild(n, scanFields);
    };
    scanFields(cls);
    const num = (n?: ts.Expression) => { const v = n && project.unwrap(n); return v && ts.isNumericLiteral(v) ? Number(v.text) : undefined; };
    const truthy = (cond: ts.Expression): boolean | undefined => {
      const c = project.unwrap(cond);
      if (ts.isPrefixUnaryExpression(c) && c.operator === ts.SyntaxKind.ExclamationToken) { const v = truthy(c.operand); return v === undefined ? undefined : !v; }
      // Only a field demonstrably assigned from the route's params is known; any other condition is unknown.
      if (ts.isPropertyAccessExpression(c) && c.expression.kind === ts.SyntaxKind.ThisKeyword && routeFields.has(c.name.text)) return hasRouteParam;
      return undefined;
    };
    function validators(node: ts.Expression, rules: Rules) {
      const n = project.unwrap(node);
      if(nonblankValidator(project,n)){rules.required=true;rules.patterns=[...rules.patterns??[],'[\\s\\S]*\\S[\\s\\S]*'];return;}
      if (ts.isArrayLiteralExpression(n)) { n.elements.forEach(e => validators(ts.isSpreadElement(e) ? e.expression : e, rules)); return; }
      if (ts.isObjectLiteralExpression(n)) { const v = project.property(n, 'validators'); if (v) validators(v, rules); return; }
      if (ts.isConditionalExpression(n)) {
        const v = truthy(n.condition);
        if (v !== undefined) { validators(v ? n.whenTrue : n.whenFalse, rules); return; }
        // Unknown condition: keep the constraints both branches agree could apply, but never claim `required`.
        const both: Rules = {};
        validators(n.whenTrue, both); validators(n.whenFalse, both);
        delete both.required; delete both.requiredTrue;
        Object.assign(rules, both);
        return;
      }
      if (ts.isPropertyAccessExpression(n) && n.expression.getText() === 'Validators') {
        if (n.name.text === 'required') rules.required = true;
        if (n.name.text === 'requiredTrue') { rules.required = true; rules.requiredTrue = true; }
        if (n.name.text === 'email') rules.email = true;
      }
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.expression.getText() === 'Validators') {
        const k = n.expression.name.text;
        if (k === 'minLength' || k === 'maxLength' || k === 'min' || k === 'max') { const v = num(n.arguments[0]); if (v !== undefined) rules[k] = v; }
        if (k === 'pattern') {
          const a0 = n.arguments[0];
          let v = project.string(a0);
          if (v === undefined && a0 && ts.isRegularExpressionLiteral(a0)) v = /^\/([\s\S]*)\/[a-z]*$/.exec(a0.text)?.[1];
          if (v !== undefined) rules.pattern = v;
        }
        if (k === 'compose' && n.arguments[0]) validators(n.arguments[0], rules);
      }
    }
    const visit = (node: ts.Node) => {
      const group = ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && node.left.getText() === `this.${formName}` ? node.right
        : ts.isPropertyDeclaration(node) && nameOf(node) === formName ? node.initializer : undefined;
      if (group && (ts.isCallExpression(group) || ts.isNewExpression(group))) {
        const callee=group.expression.getText().split('.').at(-1);
        if(['FormControl','UntypedFormControl','control'].includes(callee??'')){
          const own:Rules={};if(group.arguments?.[1])validators(group.arguments[1],own);result.set(formName,own);
        }
        const object = project.object(group.arguments?.[0]);
        for (const prop of object?.properties ?? []) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const rules: Rules = {};
          const init = project.unwrap(prop.initializer);
          if (ts.isArrayLiteralExpression(init)) init.elements.slice(1).forEach(e => validators(ts.isSpreadElement(e) ? e.expression : e, rules));
          else if ((ts.isNewExpression(init) || ts.isCallExpression(init)) && init.arguments?.[1]) validators(init.arguments[1], rules);
          result.set(nameOf(prop), rules);
        }
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'addControl' && node.expression.expression.getText() === `this.${formName}` && node.arguments[1]) {
        const name = project.string(node.arguments[0]);
        const init = project.unwrap(node.arguments[1]);
        if (name !== undefined) { const rules: Rules = {}; if ((ts.isNewExpression(init) || ts.isCallExpression(init)) && init.arguments?.[1]) validators(init.arguments[1], rules); result.set(name, rules); }
      }
      // A manual `Validators.email(this.form.controls.email)` check in the submit handler is part of the contract.
      if (ts.isCallExpression(node) && node.expression.getText() === 'Validators.email' && node.arguments[0]) {
        const m = new RegExp(`this\\.${formName}\\.controls\\.(\\w+)`).exec(node.arguments[0].getText());
        if (m) result.set(m[1], { ...result.get(m[1]), email: true });
      }
      ts.forEachChild(node, visit);
    };
    visit(cls);
    return result;
  }
  const EMAIL = "^(?=.{1,254}$)(?=.{1,64}@)[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$";
  function constrain(base: { [k: string]: unknown }, r: Rules | undefined, required: boolean): Schema {
    return constrainControlSchema(base,r,required);
  }

  function nodesWithin(nodes: HtmlNode[], fold?: (expr: string) => boolean | undefined): TmplAstElement[] {
    const elements: TmplAstElement[] = [];
    function visit(node: HtmlNode) {
      if (node instanceof TmplAstElement) elements.push(node);
      const n = node as unknown as { children?: HtmlNode[]; branches?: { children: HtmlNode[] }[]; cases?: { children: HtmlNode[] }[]; groups?: { children: HtmlNode[] }[] };
      for (const child of n.children ?? []) visit(child);
      let taken = false;
      for (const branch of [...n.branches ?? [], ...n.cases ?? [], ...n.groups ?? []]) {
        const expr = (branch as unknown as { expression?: { source?: string | null } | null }).expression?.source;
        const known = fold && expr ? fold(expr) : undefined;
        if (known === false || taken && !expr) continue;
        if (known === true) taken = true;
        for (const child of branch.children) visit(child);
      }
    }
    nodes.forEach(visit);
    return elements;
  }
  const attr = (node: TmplAstElement, name: string) => node.attributes.find(a => a.name.toLowerCase() === name.toLowerCase())?.value;
  const selectorFor = (node: TmplAstElement) => {
    const id = attr(node, 'id');
    if (id && /^[a-zA-Z][\w-]*$/.test(id)) return `${node.name}#${id}`;
    const classes = attr(node, 'class')?.split(/\s+/).filter(c => /^[a-zA-Z_][\w-]*$/.test(c));
    if (classes?.length) return `${node.name}.${classes.join('.')}`;
    // Without an id or class, static attributes keep the selector specific (e.g. button[matbutton="filled"][type="button"]).
    const extra = node.attributes.filter(a => !['class', 'id', 'style'].includes(a.name.toLowerCase()) && a.value && /^[\w .:/-]+$/.test(a.value)).slice(0, 2).map(a => `[${a.name.toLowerCase()}=${JSON.stringify(a.value)}]`).join('');
    return `${node.name}${extra}`;
  };

  // Follow source-authored helpers on the component and injected services, never arbitrary runtime callbacks.
  function opensDialogs(cls: ts.ClassDeclaration, method: ts.MethodDeclaration, scope: Scope): { component: ts.ClassDeclaration; panel: string }[] {
    const result: { component: ts.ClassDeclaration; panel: string }[] = [];
    const visited = new Set<ts.MethodDeclaration>();
    const follow = (owner: ts.ClassDeclaration, current: ts.MethodDeclaration) => {
      if (visited.has(current) || !current.body) return;
      visited.add(current);
      const deps = injected(owner);
      const scan = (n: ts.Node) => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
          const callee = n.expression;
          if (callee.expression.kind === ts.SyntaxKind.ThisKeyword) {
            const helper = owner.members.find((m): m is ts.MethodDeclaration => ts.isMethodDeclaration(m) && nameOf(m) === callee.name.text);
            if (helper) follow(owner, helper);
          } else if (ts.isPropertyAccessExpression(callee.expression) && callee.expression.expression.kind === ts.SyntaxKind.ThisKeyword) {
            const token = deps.get(callee.expression.name.text);
            if (token && ts.isClassDeclaration(token)) {
              const service = scope.providers.get(token) ?? token;
              const material = nameOf(token) === 'MatDialog' && callee.name.text === 'open';
              const zorro = nameOf(token) === 'NzModalService' && callee.name.text === 'create';
              // NzModalService.confirm/info/success/error/warning are confirmations, not editable dialog workflows.
              const component = material ? project.classAt(n.arguments[0])
                : zorro ? project.classAt(project.property(project.object(n.arguments[0]), 'nzContent')) : undefined;
              if (component) {
                const panel = material ? 'mat-dialog-container' : '.ant-modal';
                if (!result.some(d => d.component === component && d.panel === panel)) result.push({ component, panel });
              } else if (!service.getSourceFile().isDeclarationFile && !service.getSourceFile().fileName.includes('/node_modules/')) {
                const helper = service.members.find((m): m is ts.MethodDeclaration => ts.isMethodDeclaration(m) && nameOf(m) === callee.name.text);
                if (helper) follow(service, helper);
              }
            }
          }
        }
        ts.forEachChild(n, scan);
      };
      scan(current.body);
    };
    follow(cls, method);
    return result;
  }
  function discover(cls: ts.ClassDeclaration, scope: Scope, componentStack = new Set<ts.Node>(), inLoop = false, hosted = false, dialogCtx?: { trigger: string; panel: string; owner?: string; matchText?: string | string[]; target?: Capability['target']; bindings: Capability['bindings'] }, forwarded?:{output:string;component:string;handler:string;bindings:Capability['bindings'];paths:string[][]}, hostInputs?:HostInputs, hostTarget?:Capability['target']) {
    if (componentStack.has(cls)) return;
    const stack = new Set(componentStack).add(cls);
    const maybeTemplate = project.template(cls);
    const meta = project.metadata(cls, 'Component');
    const maybeSelector = meta && (project.string(project.property(meta, 'selector')) ?? 'ng-component');
    if (!maybeTemplate || !maybeSelector) return;
    const template = maybeTemplate;
    const componentSelector = maybeSelector;
    const parsed = parseTemplate(template.text, template.file);
    if (parsed.errors?.length) { warn('template-error', parsed.errors.map(e => e.toString()).join('\n'), cls); return; }
    const scoped = providers(project.property(meta, 'providers'), scope);
    // Material menus: map elements inside a <mat-menu> to the trigger that opens it.
    const menuOf = new Map<TmplAstElement, { trigger: string;panel:string }>();
    {
      const all = allElements(parsed.nodes);
      for (const menu of all.filter(e => e.name === 'mat-menu'||e.name==='nz-dropdown-menu')) {
        const ref = menu.references[0]?.name;
        const trigger = ref && all.find(e => e.inputs.some(i => ['matMenuTriggerFor','nzDropdownMenu'].includes(i.name) && i.value instanceof ASTWithSource && i.value.source === ref));
        if (!trigger) continue;
        const triggerSelector = `${componentSelector} ${selectorFor(trigger)}${menu.name==='mat-menu'?'[aria-haspopup="menu"]':''}`;
        for (const inner of nodesWithin(menu.children)) menuOf.set(inner, { trigger: triggerSelector,panel:menu.name==='mat-menu'?'.mat-mdc-menu-panel':'.ant-dropdown' });
      }
    }
    // Statically fold `@if (x === 'literal')` where x is derived from the route URL's last segment.
    const routeDerived = new Set<string>();
    const scanAssign = (n: ts.Node) => {
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && n.left.getText().startsWith('this.') && /snapshot\.url/.test(n.right.getText()) && /\.path\b/.test(n.right.getText())) routeDerived.add(n.left.getText().slice(5));
      ts.forEachChild(n, scanAssign);
    };
    scanAssign(cls);
    const lastSegment = scope.path.split('/').filter(Boolean).at(-1);
    // Validators only constrain the contract when the application enforces them (guards on `form.invalid/valid`).
    const enforces = (formName: string) => new RegExp(`\\b${formName}\\.(invalid|valid)\\b`).test(cls.getText() + template.text);
    const fold = (expr: string): boolean | undefined => {
      const hosted=hostInputs&&foldHostInput(expr,hostInputs);if(hosted!==undefined)return hosted;
      const m = /^\s*(\w+)\s*(===|!==)\s*['"]([^'"]*)['"]\s*$/.exec(expr);
      if (!m || !routeDerived.has(m[1]) || lastSegment === undefined || lastSegment.startsWith(':')) return undefined;
      return (lastSegment === m[3]) === (m[2] === '===');
    };

    function visit(node: HtmlNode, loops: string[] = inLoop ? ['*'] : []) {
      const repeated = loops.length > 0;
      if(node instanceof TmplAstTemplate){const condition=node.templateAttrs.find(a=>a.name==='ngIf')?.value;if(condition instanceof ASTWithSource&&fold(condition.source??'')===false)return;}
      if (node instanceof TmplAstElement) {
        for (const event of node.outputs) {
          if (!['click', 'ngSubmit', 'submit','blur','keyup.enter'].includes(event.name)) continue;
          const calls: Call[] = [];
          class Calls extends RecursiveAstVisitor {
            override visitCall(ast: Call, context: unknown) {
              if (ast.receiver instanceof PropertyRead && ast.receiver.receiver instanceof ImplicitReceiver && ast.receiver.name !== '$any') calls.push(ast);
              // `resource.reload()` style retry: a refresh method on a component field that was built from a service call.
              else if (ast.receiver instanceof PropertyRead && ast.receiver.receiver instanceof PropertyRead && ast.receiver.receiver.receiver instanceof ImplicitReceiver&&ast.receiver.receiver.name!=='$event') calls.push(ast);
              return calls.includes(ast)?undefined:super.visitCall(ast, context);
            }
          }
          event.handler.visit(new Calls());
          if (calls.length !== 1) continue;
          const memberCall = calls[0].receiver instanceof PropertyRead && calls[0].receiver.receiver instanceof PropertyRead;
          const eventName = memberCall ? `${((calls[0].receiver as PropertyRead).receiver as PropertyRead).name}.${(calls[0].receiver as PropertyRead).name}` : (calls[0].receiver as PropertyRead).name;
          const receiver=memberCall?((calls[0].receiver as PropertyRead).receiver as PropertyRead).name:undefined;
          const callbacks=receiver&&loops.includes(receiver)&&!calls[0].args.length?resolveTemplateCallbacks(project,cls,parsed.nodes,node,receiver,(calls[0].receiver as PropertyRead).name):[];
          const ordinaryHandler = memberCall
            ? cls.members.find((m): m is ts.PropertyDeclaration => ts.isPropertyDeclaration(m) && nameOf(m) === eventName.split('.')[0] && !!m.initializer)
            : cls.members.find(m => ts.isMethodDeclaration(m) && !m.modifiers?.some(mod => [ts.SyntaxKind.PrivateKeyword,ts.SyntaxKind.StaticKeyword].includes(mod.kind)) && nameOf(m) === eventName);
          const resolutions=callbacks.length?callbacks.map(callback=>({handler:callback.method,callback})):[{handler:ordinaryHandler,callback:undefined}];
          for(const resolution of resolutions){
          const handler=resolution.handler;
          const handlerName=resolution.callback?nameOf(handler!):eventName;
          if (!handler || !(ts.isMethodDeclaration(handler) || ts.isPropertyDeclaration(handler))) continue;
          const textFlow=ts.isMethodDeclaration(handler)?textEventWorkflow(project,cls,parsed.nodes,node,event.name,handler,componentSelector,selectorFor):undefined;
          if(event.name==='keyup.enter'&&!textFlow||textFlow?.duplicateOfEnter)continue;
          const expressionSource=event.handler instanceof ASTWithSource?event.handler.source??'':'';
          const traced = trace(cls, handler, scoped,memberCall&&!resolution.callback?{receiver:handlerName.split('.')[0],method:handlerName.split('.')[1],arguments:calls[0].args.map(a=>expressionSource.slice(a.span.start,a.span.end))}:undefined);
          const opened = ts.isMethodDeclaration(handler) ? opensDialogs(cls, handler, scoped) : [];
          // A dialog's Save usually just closes the dialog with its value; the opener's afterClosed callback does the work.
          const closesDialog = !!dialogCtx && /\.close\(/.test(handler.getText());
          const forwardsForm=!!forwarded&&handler.getText().includes(`this.${forwarded.output}.emit(`);
          const effectBindings = forwardsForm?[...forwarded!.bindings,...traced.bindings]:traced.bindings.length ? traced.bindings : closesDialog ? dialogCtx!.bindings : [];
          if (!effectBindings.length && !traced.stateful && !opened.length) continue;
          const isForm = node.name === 'form';
          const fields: Field[] = [];
          const handlerSources=new Map<string,string>();
          const issues: string[] = [];
          const signalForm=nodesWithin(parsed.nodes).some(el=>el.inputs.some(i=>i.name==='formField'));
          let plan:Capability['plan'];
          let drive:Capability['drive'];
          let plannedSchema:Schema|undefined;
          let extraSelector: string | undefined;
          // A submit button outside its [formGroup] (no ancestor relation) drives that form as a workflow.
          const externalForm = !isForm && !signalForm ? (() => {
            const groups = nodesWithin(parsed.nodes, fold).filter(el => el.inputs.some(i => i.name === 'formGroup'));
            const ref = groups.length === 1 ? groups[0].inputs.find(i => i.name === 'formGroup')?.value : undefined;
            const name = ref instanceof ASTWithSource ? ref.source : undefined;
            if (name && new RegExp(`this\\.${name}\\b`).test(handler.getText())) return groups[0];
            if (groups.length) return undefined;
            // Template-driven forms: a <form> of [(ngModel)] controls whose model root the handler (or a helper it calls) uses.
            const text = [handler, ...cls.members.filter((m): m is ts.MethodDeclaration => ts.isMethodDeclaration(m))].map(m => m.getText()).join('\n');
            const ngForms = nodesWithin(parsed.nodes, fold).filter(el => el.name === 'form' && nodesWithin(el.children, fold).some(c => c.inputs.some(i => i.name === 'ngModel')));
            const usable = ngForms.filter(f => nodesWithin(f.children, fold).some(c => { const v = c.inputs.find(i => i.name === 'ngModel')?.value; const root = v instanceof ASTWithSource ? /^(\w+)/.exec(v.source ?? '')?.[1] : undefined; return !!root && new RegExp(`this\\.${root}\\b`).test(text); }));
            return usable.length === 1 ? usable[0] : undefined;
          })() : undefined;
          // Template-driven forms: a field is not an input when the handler overwrites it (a reset). Only writes to the form's own model count.
          const handlerText = handler.getText();
          const modelRoots = new Set(externalForm ? nodesWithin(externalForm.children, fold).flatMap(c => { const v = c.inputs.find(i => i.name === 'ngModel')?.value; const r = v instanceof ASTWithSource ? /^(\w+)\./.exec(v.source ?? '')?.[1] : undefined; return r ? [r] : []; }) : []);
          const writtenByHandler = new Set([...modelRoots].flatMap(root => [...handlerText.matchAll(new RegExp(`this\\.${root}\\.(\\w+)\\s*=[^=]`, 'g'))].map(m => m[1])));
          // Replacing the whole model only counts as a reset when it happens before the model is read (`add() { push(this.model); this.model = {} }` reads first).
          const allWritten = [...modelRoots].some(root => {
            const write = handlerText.search(new RegExp(`this\\.${root}\\s*=[^=]`));
            const read = handlerText.search(new RegExp(`this\\.${root}(?!\\w)(?!\\s*=[^=])`));
            return write >= 0 && (read < 0 || write < read);
          });
          // Tag-style list inputs: a text control committed with Enter whose handler appends to a signal list.
          const lists: NonNullable<NonNullable<Capability['plan']>['lists']> = [];
          if (externalForm) for (const el of nodesWithin(parsed.nodes, fold)) {
            const commit = el.outputs.find(o => o.name === 'keyup.enter');
            const call = commit?.handler instanceof ASTWithSource ? /^(\w+)\(\)$/.exec(commit.handler.source ?? '') : null;
            const method = call && cls.members.find(m => ts.isMethodDeclaration(m) && nameOf(m) === call[1]);
            const text = method?.getText() ?? '';
            const target = /this\.(\w+)\.(update|set)\(/.exec(text)?.[1];
            if (target) lists.push({ name: target, input: { selector: selectorFor(el) }, commit: 'enter', minLength: /trim\(\)\s*!==\s*''/.test(text) ? 1 : 0, unique: /indexOf\(|includes\(/.test(text) });
          }
          if(signalForm&&!isForm) issues.push('Use the compiled form workflow for this Signal Forms action');
          // Repeated/hosted actions are selected by the identity of the data they act on.
          let target: Capability['target']=hostTarget?{...hostTarget}:resolution.callback?{param:'__callbackItem',source:'context',path:resolution.callback.identity.path,literalValue:resolution.callback.identity.value}:undefined;
          let allowDuplicates = false;
          let matchText: string | string[] | undefined;
          if (repeated || hosted) {
            // Source-typed objects passed by a loop or signal input select an existing entity by its identity.
            // They are selection arguments, never arbitrary edits to that object's readonly display data.
            const signalInput=(member:ts.ClassElement):boolean=>{
              if(!ts.isPropertyDeclaration(member)||!member.initializer)return false;
              const initializer=project.unwrap(member.initializer);if(!ts.isCallExpression(initializer))return false;
              const factory=ts.isPropertyAccessExpression(initializer.expression)&&initializer.expression.name.text==='required'?initializer.expression.expression:initializer.expression;
              return project.angularFunction(factory,'input')||project.angularFunction(factory,'model');
            };
            const signalMembers=new Set(cls.members.filter(signalInput).map(nameOf));
            const inputMembers=new Set(cls.members.filter(member=>(ts.isPropertyDeclaration(member)||ts.isSetAccessorDeclaration(member))&&(signalMembers.has(nameOf(member))||(ts.getDecorators(member)??[]).some(decorator=>ts.isCallExpression(decorator.expression)&&project.angularFunction(decorator.expression.expression,'Input')))).map(nameOf));
            const componentPath=(a:unknown):{path:string[];signals:string[]}|undefined=>{
              if(a instanceof PropertyRead){if(a.receiver instanceof ImplicitReceiver&&inputMembers.has(a.name))return {path:[a.name],signals:[]};const root=componentPath(a.receiver);return root?{...root,path:[...root.path,a.name]}:undefined;}
              if(a instanceof Call&&a.args.length===0&&a.receiver instanceof PropertyRead&&a.receiver.receiver instanceof ImplicitReceiver&&signalMembers.has(a.receiver.name))return {path:[a.receiver.name],signals:[a.receiver.name]};
              return undefined;
            };
            const contextPath=(a:unknown):string[]|undefined=>{if(!(a instanceof PropertyRead))return;if(a.receiver instanceof ImplicitReceiver&&loops.includes(a.name))return [];const root=contextPath(a.receiver);return root?[...root,a.name]:undefined;};
            const binding=effectBindings.find(b=>b.method===handlerName.split('.').at(-1))??effectBindings[0];
            const uiSchema=!memberCall&&ts.isMethodDeclaration(handler)?new SchemaCompiler(project.checker).method(handler).inputSchema:binding?.inputSchema;
            const inputs=typeof uiSchema==='object'?(uiSchema as {properties?:Record<string,Schema>}).properties??{}:{};
            for(const [index,argument]of calls[0].args.entries()){
              const name=Object.keys(inputs)[index],schema=inputs[name],object=schema&&typeof schema==='object'?schema as {properties?:Record<string,Schema>}:undefined;
              const identity=['id','_id','slug','username','key'].find(key=>object?.properties?.[key]!==undefined);
              if(!identity)continue;
              const identityCall=!memberCall&&ts.isMethodDeclaration(handler)?effectBindings.find(b=>b.arguments.some(a=>a===`${name}.${identity}`)):undefined;
              if(identityCall){
                const argumentIndex=identityCall.arguments.findIndex(a=>a===`${name}.${identity}`);
                const key=Object.keys((identityCall.inputSchema as {properties?:object}).properties??{})[argumentIndex]??identity.replace(/^_+/, '');
                const param=routeParamsOf(scope.path).includes(key)?name+key[0].toUpperCase()+key.slice(1):key;
                const fromComponent=componentPath(argument),fromContext=contextPath(argument),inputSchema=object!.properties![identity];
                if(fromComponent)target={param,source:'component',path:[...fromComponent.path,identity],signals:fromComponent.signals,inputSchema};
                else if(fromContext)target={param,source:'context',path:[...fromContext,identity],inputSchema};
                if(target)break;
              }
              // An identity-only DTO is a row key. Dialog openers also bind existing row identity;
              // the dialog's authored controls supply editable values separately.
              if(opened.length||Object.keys(object?.properties??{}).length===1)continue;
              const fromComponent=componentPath(argument),fromContext=contextPath(argument);
              if(fromComponent)target={param:name,source:'component',path:[...fromComponent.path,identity],signals:fromComponent.signals,valuePath:[identity],inputSchema:schema};
              else if(fromContext)target={param:name,source:'context',path:[...fromContext,identity],valuePath:[identity],inputSchema:schema};
              if(target)break;
            }
            const loopArg = calls[0].args.find((a): a is PropertyRead => a instanceof PropertyRead && a.receiver instanceof PropertyRead && a.receiver.receiver instanceof ImplicitReceiver && loops.includes(a.receiver.name));
            const isInput = (name: string) => inputMembers.has(name);
            // The loop variable itself (e.g. `setPageTo(pageNumber)`): the value is the item, named after the variable.
            const itemArg = calls[0].args.find((a): a is PropertyRead => a instanceof PropertyRead && a.receiver instanceof ImplicitReceiver && loops.includes(a.name));
            // A row's id must not share a name with a route parameter (project :id vs task id): name it after the row variable.
            const distinct = (param: string, entity: string) => routeParamsOf(scope.path).includes(param) ? entity + param[0].toUpperCase() + param.slice(1) : param;
            if (!target&&loopArg){const scalar=Object.keys(inputs)[0],schema=scalar&&inputs[scalar];target = { param: distinct(scalar||loopArg.name, (loopArg.receiver as PropertyRead).name), source: 'context', path: [loopArg.name],...(schema&&typeof schema==='object'?{inputSchema:schema}:{}) };}
            else if (!target&&itemArg) {
              // A whole item (`toggle(todo)`): the handler acts on its identity property, otherwise on the item value itself.
              const bodyText = handler.getText();
              const identities = ['id', '_id', 'slug', 'username', 'key', 'name'];
              // The handler may only pass the item along (`openEdit(item)`); its declared type still says what identifies it.
              const paramType = ts.isMethodDeclaration(handler) && handler.parameters[0] ? project.checker.getTypeAtLocation(handler.parameters[0]) : undefined;
              const identity = identities.find(p => new RegExp(`\\b${itemArg.name}\\.${p}\\b`).test(bodyText)) ?? identities.find(p => !!paramType?.getProperty(p));
              if (identity) { target = { param: distinct(identity.replace(/^_+/, ''), itemArg.name), source: 'context', path: [identity] }; }
              const param = itemArg.name.replace(/(Number|Index|Idx)$/, '') || itemArg.name;
              const source = new RegExp(`@for\\s*\\(\\s*${itemArg.name}\\s+of\\s+([\\w.]+)|let\\s+${itemArg.name}\\s+of\\s+([\\w.]+)`).exec(template.text);
              const list = source?.[1] ?? source?.[2];
              const oneBased = !!list && new RegExp(`${list}\\.set\\([\\s\\S]{0,240}?\\+\\s*1`).test(cls.getText());
              const numeric = handler && ts.isMethodDeclaration(handler) && handler.parameters.some(p => /number/.test(p.type?.getText() ?? ''));
              if (!target) target = { param, source: 'context', path: [], ...(numeric ? { integer: true, minimum: oneBased ? 1 : 0 } : {}) };
            }
            else for (const b of traced.bindings) for (const a of b.arguments) {
              const m = /^this\.(\w+)\.(\w+)$/.exec(a);
              if (m && isInput(m[1]) && !target) target = { param: m[2], source: 'component', path: [m[1], m[2]] };
            }
          }
          const sameSelector = nodesWithin(parsed.nodes).filter(el => selectorFor(el) === selectorFor(node));
          // Several controls share a selector (a row's Edit/Archive/Delete icon buttons): tell them apart by handler text, with or without a row target.
          if (sameSelector.length > 1) {
            const expr = (el: TmplAstElement) => el.outputs.filter(o => o.name === event.name).map(o => o.handler instanceof ASTWithSource ? o.handler.source : '').join('|');
            const plain = (el: TmplAstElement) => template.text.slice(el.startSourceSpan.end.offset, el.endSourceSpan?.start.offset ?? el.sourceSpan.end.offset).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            // Visible text: static, or a lone interpolation whose quoted literals are the only possible values (`{{ a ? 'Restore' : 'Archive' }}`).
            const variants = (el: TmplAstElement): string[] | undefined => {
              const t = plain(el);
              if (!t) return undefined;
              if (!t.includes('{{')) return [t];
              const m = /^\{\{([\s\S]*)\}\}$/.exec(t);
              const literals = m ? [...m[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map(x => x[1] ?? x[2]) : [];
              return literals.length ? literals : undefined;
            };
            const all = sameSelector.map(variants);
            const flat = all.flatMap(v => v ?? []);
            const texts = sameSelector.map(plain);
            if (sameSelector.every(el => expr(el) === expr(node))) { if (!target) allowDuplicates = true; }
            else if (variants(node)&&all.every((v,index)=>sameSelector[index]===node||!v||!v.some(t=>variants(node)!.includes(t)))) { const mine = variants(node)!; matchText = mine.length === 1 ? mine[0] : mine; }
            else issues.push('The template has multiple controls matching this selector');
          }
          if(!matchText&&node.name!=='form'){
            const text=template.text.slice(node.startSourceSpan.end.offset,node.endSourceSpan?.start.offset??node.sourceSpan.end.offset).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
            if(text&&!text.includes('{{'))matchText=text;
          }
          const menuReveal = menuOf.get(node);
          if(menuReveal&&target?.source==='context'){const projected=projectedTarget(project,cls,parsed.nodes,node,calls[0].args,target,componentSelector,selectors);if(projected)target={...target,projected};}
          let reveal:Capability['reveal'] = menuReveal ? { trigger: menuReveal.trigger, panel: menuReveal.panel, kind: 'menu' as const, owner: componentSelector }
            : dialogCtx ? { trigger: dialogCtx.trigger, panel: dialogCtx.panel, kind: 'dialog' as const, ...(dialogCtx.owner ? { owner: dialogCtx.owner } : {}), ...(dialogCtx.matchText ? { matchText: dialogCtx.matchText } : {}), ...(dialogCtx.target ? { target: dialogCtx.target } : {}) } : undefined;
          const actionSelector = menuReveal ? `${menuReveal.panel} ${selectorFor(node)}` : `${componentSelector} ${selectorFor(node)}`;
          if(textFlow){
            fields.push(textFlow.field);issues.push(...textFlow.issues);
            plan={mode:'edit',root:componentSelector,targetRoot:componentSelector,repeats:[],commit:textFlow.commit};
            if(textFlow.reveal)reveal={...textFlow.reveal,...target?{target}:{}};
          }
          // Dialogs this handler opens: their forms become capabilities that open the dialog through this trigger first.
          for (const dialog of opened) discover(dialog.component, scoped, new Set(stack), false, false, { trigger: actionSelector, panel: dialog.panel, owner: componentSelector, ...(matchText ? { matchText } : {}), ...(target ? { target } : {}), bindings: effectBindings });
          let submitSelector: string | undefined;
          if(isForm&&signalForm){
            const parsedControls=controls(project,cls,node.children);
            fields.push(...parsedControls.fields);issues.push(...parsedControls.issues);
            const buttons=allElements(parsed.nodes).filter(el=>el.name==='button'&&el.outputs.some(o=>o.name==='click'&&o.handler instanceof ASTWithSource&&o.handler.source===`${handlerName}()`));
            if(buttons.length!==1)issues.push('Signal Forms workflow needs exactly one associated submit action');
            else plan={mode:'submit',root:componentSelector,submit:locator(buttons[0],parsed.nodes),repeats:parsedControls.repeats};
            plannedSchema=schemaForControls(fields,parsedControls.repeats,parsedControls.rules);
          } else if (isForm || externalForm) {
            const formEl = isForm ? node : externalForm!;
            const formValue = formEl.inputs.find(i => i.name === 'formGroup')?.value;
            const formName = formValue instanceof ASTWithSource ? formValue.source ?? undefined : undefined;
            const rules = formName && enforces(formName) ? formRules(cls, formName, scope.path.includes(':')) : new Map<string, Rules>();
            const elements = nodesWithin(formEl.children, fold);
            const submitEntries=elements.flatMap(n=>{const selector=nativeSubmit(project,selectors,n,selectorFor);return selector?[{node:n,selector}]:[];});
            const submit=submitEntries.map(entry=>entry.node);
            if (externalForm) {
              plan = { mode: 'submit', root: componentSelector, submit: locator(node, parsed.nodes), repeats: [], ...(lists.length ? { lists } : {}) };
              extraSelector = `${componentSelector} ${selectorFor(externalForm)}`;
            } else if (submit.length === 1) submitSelector = submitEntries[0].selector;
            else issues.push('Form requires exactly one identifiable submit button');
            const wrapped=new Map<TmplAstElement,{fields:Field[];issues:string[]}>();
            for(const element of elements){
              const result=wrappedControls(project,cls,element,formName,selectors,formEl.children);
              if(!result)continue;wrapped.set(element,result);
              for(const field of result.fields){const rule=rules.get(field.name);field.required=field.required||!!rule?.required;field.schema=constrain(field.schema as {[key:string]:unknown},rule,field.required);fields.push(field);}
              issues.push(...result.issues);
            }
            const standalone = elements.filter(el => el.inputs.some(i => i.name === 'formControl') && !el.outputs.some(o => o.name === 'keyup.enter'));
            // Forms with Material controls are filled through the Material-aware workflow plan instead of native setters.
            const materialHandled = elements.some(el => ['mat-select', 'mat-checkbox', 'mat-slide-toggle'].includes(el.name) && (attr(el, 'formControlName') !== undefined || el.inputs.some(i => i.name === 'ngModel')));
            if (materialHandled) {
              const pc = controls(project, cls, formEl.children);
              for (const f of pc.fields) {
                const el = elements.find(el=>(attr(el,'formControlName')??attr(el,'name')??(el.inputs.find(i=>i.name==='ngModel')?.value instanceof ASTWithSource?(el.inputs.find(i=>i.name==='ngModel')!.value as ASTWithSource).source?.split('.').at(-1):undefined))===f.name);
                const r = mergeControlRules(rules.get(f.name),el?templateControlRules(project,cls,el):undefined);
                f.required = f.required || !!r?.required;
                f.schema = constrain(f.schema as { [k: string]: unknown }, r, f.required);
              }
              fields.push(...pc.fields.filter(f => !(externalForm && (allWritten || writtenByHandler.has(f.name))))); issues.push(...pc.issues);
              const submitEl = isForm ? (submit.length === 1 ? submit[0] : undefined) : node;
              if (!submitEl) issues.push('Form requires exactly one identifiable submit button');
              else { plan = { mode: 'submit', root: componentSelector, submit: locator(submitEl, parsed.nodes), repeats: pc.repeats }; extraSelector = `${componentSelector} ${selectorFor(formEl)}`; submitSelector = undefined; }
              plannedSchema = schemaForControls(fields, pc.repeats, new Map(), false);
            }
            for (const el of (materialHandled ? [] : elements)) {
              if(wrapped.has(el))continue;
              if (el.outputs.some(o => o.name === 'keyup.enter') && lists.some(l => l.input.selector === selectorFor(el))) continue;
              const controlRef = el.inputs.find(i => i.name === 'formControl')?.value;
              const controlName = controlRef instanceof ASTWithSource ? controlRef.source ?? undefined : undefined;
              // A standalone [formControl] takes its public name from the service parameter that receives its value.
              let derived: string | undefined;
              if (controlName) for (const b of traced.bindings) b.arguments.forEach((a, i) => { if (a === `this.${controlName}.value` && !derived) { const param = Object.keys((b.inputSchema as { properties?: object }).properties ?? {})[i]; derived = b.paramKeys?.[param] ?? param; } });
              const modelRef = el.inputs.find(i => i.name === 'ngModel')?.value;
              const modelName = modelRef instanceof ASTWithSource ? modelRef.source?.split('.').at(-1) : undefined;
              const name = attr(el, 'formControlName') ?? attr(el, 'name') ?? derived ?? controlName ?? modelName;
              if (!name) continue;
              if (externalForm && (allWritten || writtenByHandler.has(name))) continue; // the handler overwrites it, so it is not an input
              const lone = !!controlName && standalone.length === 1 && !rules.has(name);
              const type = attr(el, 'type') ?? 'text';
              const supported = ['input', 'textarea', 'select','quill-editor'].includes(el.name) && !['file', 'hidden', 'radio'].includes(type) && !el.inputs.some(i => i.name === 'matDatepicker');
              const info = optionInfo(el);
              const resolvedValues = info.dynamic ? resolveLoopOptions(project, cls, el) : undefined;
              if (resolvedValues) { info.values = resolvedValues; info.dynamic = false; }
              const ownRules=controlName?formRules(cls,controlName,scope.path.includes(':')).get(controlName):undefined;
              const submitDisabled=submit.length===1?submit[0].inputs.find(input=>input.name==='disabled')?.value:undefined;
              const emptyDisabled=!!controlName&&submitDisabled instanceof ASTWithSource&&new RegExp(`!\\s*${controlName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\.value\\b`).test(submitDisabled.source??'');
              const controlRules=mergeControlRules(rules.get(name),ownRules,templateControlRules(project,cls,el),emptyDisabled?{required:true}:undefined);
              const required0 = !!controlRules.required;
              const options = info.values.filter(v => !(required0 && v === ''));
              const schema: Schema = type === 'checkbox' ? { type: 'boolean' } : type === 'number' ? { type: 'number' } : options.length && !info.dynamic ? { type: 'string', enum: options } : type === 'password' ? { type: 'string', writeOnly: true } : { type: 'string' };
              const isRequired = lone || !!controlRules.required;
              if (!supported) issues.push(`Control ${name} requires an unsupported widget or locator`);
              fields.push({ name, selector: controlName && !attr(el, 'formControlName') && !attr(el, 'name') ? selectorFor(el) : `${el.name}[${attr(el,'formControlName') !== undefined ? 'formcontrolname' : 'name'}=${JSON.stringify(name)}]`, element: el.name, type, required: isRequired, supported, ...(el.name==='quill-editor'?{adapter:'contenteditable' as const}:{}), ...(el.name === 'select' && (!options.length || info.dynamic) ? { dynamicOptions: true } : {}), schema: constrain(schema as { [k: string]: unknown }, controlRules, !!controlRules.required) });
            }
            if(!plan&&[...wrapped.values()].some(result=>result.fields.some(field=>field.adapter!=='native'))){
              const button=isForm?(submit.length===1?submit[0]:undefined):node;
              if(!button)issues.push('Wrapped form controls need an identifiable submit action');
              else{plan={mode:'submit',root:componentSelector,submit:locator(button,parsed.nodes),repeats:[]};extraSelector=`${componentSelector} ${selectorFor(formEl)}`;submitSelector=undefined;}
            }
            if (new Set(fields.map(f => f.name)).size !== fields.length) issues.push('Repeated form control names require a row selection binding');
            if (elements.some(el => el.inputs.some(i => i.name === 'formField'))) issues.push('Signal Forms and repeated/custom controls require an explicit workflow binding');
          }
          if (lists.length) {
            const supported = fields.filter(f => f.supported);
            plannedSchema = { type: 'object', additionalProperties: false, required: supported.filter(f => f.required).map(f => f.name),
              properties: { ...Object.fromEntries(supported.map(f => [f.name, f.schema])),
                ...Object.fromEntries(lists.map(l => [l.name, { type: 'array', items: { type: 'string', ...(l.minLength ? { minLength: l.minLength } : {}) }, ...(l.unique ? { uniqueItems: true } : {}) } as Schema])) } };
          }
          // ngModel fields can live in an authored section rather than a <form>. Bind only controls
          // whose exact model path is passed to a traced operation, and submit through the original action.
          if(!isForm&&!externalForm&&!fields.length&&!target&&ts.isMethodDeclaration(handler)){
            const scalar=scalarModelFields(project,cls,parsed.nodes,handler,effectBindings,selectorFor);
            if(scalar){fields.push(...scalar.fields);issues.push(...scalar.issues);if(fields.length)plan={mode:'submit',root:componentSelector,targetRoot:componentSelector,submit:{selector:actionSelector},repeats:[]};}
          }
          if(!isForm&&!externalForm&&!fields.length&&!target&&ts.isMethodDeclaration(handler)){
            const supplied=new Set<string>();
            for(const el of allElements(parsed.nodes)){
              const model=el.inputs.find(i=>i.name==='ngModel')?.value;
              const path=model instanceof ASTWithSource?model.source?.trim():undefined;
              if(!path||!/^\w+(?:\.\w+)*$/.test(path))continue;
              const escaped=path.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
              if(traced.bindings.some(b=>b.arguments.some(arg=>new RegExp(`\\bthis\\.${escaped}(?![\\w.])`).test(arg)))){
                const name=attr(el,'name')??path.split('.').at(-1)!;supplied.add(name);handlerSources.set(`this.${path}`,name);
              }
            }
            if(supplied.size){
              const bound=controls(project,cls,parsed.nodes);
              fields.push(...bound.fields.filter(field=>supplied.has(field.name)));
              if(fields.length){
                issues.push(...bound.issues);plan={mode:'submit',root:componentSelector,targetRoot:componentSelector,submit:{selector:actionSelector},repeats:[]};
              }
            }
          }
          if(!isForm&&!externalForm&&!fields.length&&ts.isMethodDeclaration(handler)){
            const methodSources=[handler,...cls.members.filter((m):m is ts.MethodDeclaration=>ts.isMethodDeclaration(m)&&traced.paths.some(path=>path.includes(`${nameOf(cls)}.${nameOf(m)}`)))].map(m=>m.getText()).join('\n');
            const standalone=allElements(parsed.nodes).flatMap(el=>{const bound=el.inputs.find(i=>i.name==='formControl')?.value;const name=bound instanceof ASTWithSource?bound.source?.trim():undefined;return name&&/^[\w$]+$/.test(name)&&methodSources.includes(`this.${name}.value`)&&['input','textarea','quill-editor'].includes(el.name)?[{el,name}]:[];});
            if(standalone.length){
              for(const {el,name}of standalone){const rules=mergeControlRules(formRules(cls,name,scope.path.includes(':')).get(name),templateControlRules(project,cls,el));fields.push({name,selector:selectorFor(el),element:el.name,type:attr(el,'type')??'text',required:true,supported:true,adapter:el.name==='quill-editor'?'contenteditable':'native',schema:constrain({type:'string'},rules,!!rules.required)});}
              plan={mode:event.name==='blur'?'edit':'submit',root:componentSelector,...(event.name==='blur'?{}:{targetRoot:componentSelector,submit:{selector:actionSelector}}),repeats:[]};
              if(!reveal&&event.name!=='blur')reveal=inlineReveal(cls,parsed.nodes,allElements(parsed.nodes),node,componentSelector,selectorFor);
            }
          }
          // A reference-valued argument is an authored editable control, even when it lives beside a row button.
          if (!isForm && !externalForm && !fields.length && ts.isMethodDeclaration(handler)) {
            const referenced = calls[0].args.flatMap((argument,index) => {
              if (!(argument instanceof PropertyRead) || argument.name !== 'value' || !(argument.receiver instanceof PropertyRead) || !(argument.receiver.receiver instanceof ImplicitReceiver)) return [];
              const ref=argument.receiver.name,parameter=handler.parameters[index];
              if(!parameter||!ts.isIdentifier(parameter.name))return [];
              const controls=allElements(parsed.nodes).filter(el=>el.references.some(r=>r.name===ref)&&['input','textarea','select'].includes(el.name));
              return controls.length===1?[{control:controls[0],parameter}]:[];
            });
            if(referenced.length){
              const first=referenced[0].control;
              const contains=(parent:TmplAstElement,child:TmplAstElement)=>parent.sourceSpan.start.offset<=child.sourceSpan.start.offset&&parent.sourceSpan.end.offset>=child.sourceSpan.end.offset;
              const common=allElements(parsed.nodes).filter(el=>contains(el,node)&&referenced.every(r=>contains(el,r.control))).sort((a,b)=>(a.sourceSpan.end.offset-a.sourceSpan.start.offset)-(b.sourceSpan.end.offset-b.sourceSpan.start.offset))[0];
              if(!common)issues.push('Template-reference inputs need a common authored action container');
              else{
                for(const {control,parameter}of referenced){
                  const name=(parameter.name as ts.Identifier).text,type=attr(control,'type')??'text';
                  const authored=templateControlRules(project,cls,control);
                  fields.push({name,selector:selectorFor(control),element:control.name,type,required:!parameter.questionToken&&!parameter.initializer,supported:true,adapter:'native',schema:constrain({type:type==='number'?'number':'string'},authored,!parameter.questionToken&&!parameter.initializer)});
                }
                plan={mode:'submit',root:componentSelector,targetRoot:selectorFor(common),submit:{selector:actionSelector},repeats:[]};
              }
            }
          }
          if(ts.isMethodDeclaration(handler)){
            const guards=handlerConstraints(handler,effectBindings.map(b=>b.method),handlerSources);
            for(const field of fields)field.schema=constrainHandlerInput(field.schema,guards.get(field.name));
          }
          // A scalar argument read from a source-proven +/- widget is filled through that widget before submitting.
          if(memberCall&&!fields.length){
            const sourceBinding=effectBindings.find(b=>b.method===handlerName.split('.')[1]);
            const sourceSchema=sourceBinding&&typeof sourceBinding.inputSchema==='object'?sourceBinding.inputSchema as {properties?:Record<string,Schema>;required?:string[]}:undefined;
            if(sourceSchema?.properties)for(const [index,argument]of calls[0].args.entries()){
              const arg=expressionSource.slice(argument.span.start,argument.span.end).replace(/\s+/g,'');
              const widgets=allElements(parsed.nodes).flatMap(el=>{const child=selectors.get(el.name);const widget=child?.length===1?counterWidget(project,child[0]):undefined;const bound=widget&&el.inputs.find(i=>i.name===widget.input)?.value;return widget&&bound instanceof ASTWithSource&&bound.source?.replace(/\s+/g,'')===arg?[{el,widget}]:[];});
              if(widgets.length!==1)continue;
              const param=Object.keys(sourceSchema.properties)[index],source=sourceSchema.properties[param];
              if(typeof source!=='object')continue;
              const {default:ignoredDefault,...rest}=source;
              plannedSchema={...sourceSchema,properties:{...sourceSchema.properties,[param]:{...rest,type:'integer',...(widgets[0].widget.minimum!==undefined?{minimum:widgets[0].widget.minimum}:{})}}};
              drive={counter:{param,selector:selectorFor(widgets[0].el),...widgets[0].widget.binding,submitAction:true}};
            }
          }
          // A set of literal calls is one parameterized UI operation, not an arbitrary direct method invocation.
          if(!isForm&&!externalForm&&!fields.length&&!target&&!reveal&&ts.isMethodDeclaration(handler)&&handler.parameters.length===1&&ts.isIdentifier(handler.parameters[0].name)){
            const literal=(ast:unknown):string|number|boolean|undefined=>{
              const a=ast as {value?:unknown;operator?:string;expr?:unknown};
              if(['string','boolean'].includes(typeof a?.value)||typeof a?.value==='number'&&Number.isFinite(a.value))return a.value as string|number|boolean;
              if(a&&['+','-'].includes(a.operator??'')){const value=literal(a.expr);if(typeof value==='number')return a.operator==='-'?-value:value;}
              return undefined;
            };
            const variants=allElements(parsed.nodes).flatMap(el=>el.outputs.filter(o=>o.name==='click'&&o.handler instanceof ASTWithSource&&o.handler.ast instanceof Call&&(o.handler.ast.receiver as PropertyRead).name===handlerName).map(o=>({el,call:(o.handler as ASTWithSource).ast as Call})));
            const values=variants.map(v=>v.call.args.length===1?literal(v.call.args[0]):undefined);
            if(variants.length>1&&values.every(v=>v!==undefined)&&new Set(values).size===values.length){
              const choices=variants.map((v,index)=>({value:values[index]!,selector:`${componentSelector} ${selectorFor(v.el)}`,matchText:template.text.slice(v.el.startSourceSpan.end.offset,v.el.endSourceSpan?.start.offset??v.el.sourceSpan.end.offset).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()}));
              if(choices.some(c=>!c.matchText||c.matchText.includes('{{'))&&new Set(choices.map(c=>c.selector)).size!==choices.length)issues.push('Literal argument buttons need distinct selectors or static labels');
              const param=handler.parameters[0].name.text,types=[...new Set(values.map(v=>typeof v==='number'?(Number.isInteger(v)?'integer':'number'):typeof v))];
              drive={buttons:{param,choices}};plannedSchema={type:'object',properties:{[param]:{type:types.length===1?types[0]:types,enum:values}},required:[param],additionalProperties:false};matchText=undefined;allowDuplicates=false;
            }
          }
          if (repeated && !target) issues.push('Repeated/template-scoped UI requires an explicit row selection binding');
          if (scope.path.includes('*')) issues.push('Wildcard routes require an explicit navigation binding');
          if (scoped.uncertain) issues.push('Dynamic providers require review before code generation');
          const source = { file: template.file, line: event.sourceSpan.start.line + template.lineOffset + 1 };
          const labelNode = isForm && submitSelector ? nodesWithin(node.children).find(n => selectorFor(n) === submitSelector) ?? node : node;
          const label = template.text.slice(labelNode.startSourceSpan.end.offset, labelNode.endSourceSpan?.start.offset ?? labelNode.sourceSpan.end.offset).replace(/<[^>]*>|{{[\s\S]*?}}/g, ' ').replace(/\s+/g, ' ').trim() || handlerName;
          const logicalComponent=forwardsForm?forwarded!.component:nameOf(cls),logicalHandler=forwardsForm?forwarded!.handler:handlerName;
          const id = `${scope.path}#${logicalComponent}.${logicalHandler}:${actionSelector}${dialogCtx ? '@' + dialogCtx.trigger : ''}`;
          const supportedFields = fields.filter(f => f.supported);
          // A handler that only opens a dialog is itself an operation (open it; a person or the dialog's own capability finishes it).
          if (!(traced.bindings.length || traced.stateful || closesDialog || opened.length)) continue;
          const reserved = new Set([...routeParamsOf(scope.path), ...[target,dialogCtx?.target].flatMap(t=>t&&t.literalValue===undefined?[t.param]:[])]);
          if (fields.some(f => reserved.has(f.name))) issues.push('A form field shares its name with a route or row-selection parameter');
          if (target && dialogCtx?.target) issues.push('Two row selections (a repeated row inside a dialog opened from a repeated row) are not supported');
          // Only an authored business action can be exposed from a confirmation dialog.
          // A literal close(true/false) or Cancel is not enough to infer which operation it authorizes.
          const confirmedAction=!!dialogCtx&&!fields.length;
          if(confirmedAction&&(!traced.bindings.length&&!/this\.[\w$]+\.emit\(/.test(handler.getText())||/\.close\(\s*(true|false)\s*\)/.test(handler.getText())))continue;
          capabilities.push({ id, fingerprint: '', route: scope.path, ...(routeParamsOf(scope.path).length ? { routeParams: routeParamsOf(scope.path) } : {}), ...(target ? { target } : {}), ...(reveal ? { reveal } : {}), component: logicalComponent, componentSelector,
            action: { ...(menuReveal ? {} : { owner: componentSelector }), ...(matchText&&!extraSelector ? { matchText } : {}), ...(allowDuplicates ? { allowDuplicates } : {}), kind: isForm || externalForm ? 'form' : 'button', selector: extraSelector ?? actionSelector, ...(submitSelector ? { submitSelector } : {}), label, event: event.name, expression: event.handler instanceof ASTWithSource ? event.handler.source ?? '' : '', source }, fields,
            ...(plan?{plan}:{}),...(drive?{drive}:{}),...(confirmedAction?{contextSchema:{type:'object',properties:{confirmedCapability:{const:id}},required:['confirmedCapability'],additionalProperties:true}}:{}),
            handler: logicalHandler, callPath: [...(forwardsForm?forwarded!.paths:[]),...traced.paths].flat(), bindings: effectBindings, ...(effectBindings.length&&!(opened.length&&effectBindings.every(b=>/^(get|list|find|search|load|fetch|query|read|count|lookup|retrieve|select)/i.test(b.method))) ? {} : { effectKind: 'ui-state' as const }),
            inputSchema: withRouteParams(plannedSchema??{ type: 'object', properties: Object.fromEntries(supportedFields.map(f => [f.name, f.schema])), required: supportedFields.filter(f => f.required).map(f => f.name), additionalProperties: false }, [...new Set([...routeParamsOf(scope.path), ...((target ?? dialogCtx?.target)?.literalValue===undefined&&(target??dialogCtx?.target) ? [(target ?? dialogCtx!.target)!.param] : [])])], target ?? dialogCtx?.target),
            outputSchema: { type: 'object', properties: { status: { const: 'ui-dispatched' }, url: { type: 'string' } }, required: ['status','url'], additionalProperties: false },
            guards: [...scope.guards], workflow: { confirmation: confirmedAction||traced.confirmation.length ? 'observed' : 'not-observed', ...(confirmedAction?{requiresConfirmation:true}:{}), evidence: [...traced.confirmation,...(confirmedAction?['This action is inside an authored confirmation dialog; the host must confirm this exact capability before execution.']:[])] },
            issues, status: issues.length ? 'blocked' : 'candidate' });
          }
        }
        // Known widgets: Material paginator events and file inputs.
        const pushDriven = (handlerName: string, handlerNode: ts.MethodDeclaration, traced: ReturnType<typeof trace>, drive: Capability['drive'], actionSelector: string, label: string, event: string, schema: Schema, source: { file: string; line: number }) => {
          const routeParams = routeParamsOf(scope.path);
          const issues: string[] = [];
          if (scope.path.includes('*')) issues.push('Wildcard routes require an explicit navigation binding');
          if (scoped.uncertain) issues.push('Dynamic providers require review before code generation');
          capabilities.push({ id: `${scope.path}#${nameOf(cls)}.${handlerName}:${actionSelector}`, fingerprint: '', route: scope.path, ...(routeParams.length ? { routeParams } : {}), component: nameOf(cls), componentSelector,
            action: { owner: componentSelector, kind: 'workflow', selector: actionSelector, label, event, expression: `${handlerName}()`, source }, fields: [], drive,
            handler: handlerName, callPath: traced.paths.flat(), bindings: traced.bindings, ...(traced.bindings.length ? {} : { effectKind: 'ui-state' as const }),
            inputSchema: withRouteParams(schema, routeParams),
            outputSchema: { type: 'object', properties: { status: { const: 'ui-dispatched' }, url: { type: 'string' } }, required: ['status', 'url'], additionalProperties: false },
            guards: [...scope.guards], workflow: { confirmation: traced.confirmation.length ? 'observed' : 'not-observed', evidence: traced.confirmation }, issues, status: issues.length ? 'blocked' : 'candidate' });
        };
        const handlerCall = (ast: unknown) => { const calls2: Call[] = []; class C extends RecursiveAstVisitor { override visitCall(a: Call, c: unknown) { if (a.receiver instanceof PropertyRead && a.receiver.receiver instanceof ImplicitReceiver && a.receiver.name !== '$any') {calls2.push(a);return;} return super.visitCall(a, c); } } (ast as { visit(v: unknown): void }).visit(new C()); return calls2.length === 1 ? (calls2[0].receiver as PropertyRead).name : undefined; };
        // CDK drop outputs consume non-JSON event objects. The request describes pointer intent; the existing CDK
        // directive creates its real event and calls the source handler. Source list identity is separately bound context.
        if(node.attributes.some(a=>a.name.toLowerCase()==='cdkdroplist')||node.name==='cdk-drop-list'){
          const out=node.outputs.find(o=>o.name==='cdkDropListDropped'),name=out&&handlerCall(out.handler);
          const method=name?cls.members.find((m):m is ts.MethodDeclaration=>ts.isMethodDeclaration(m)&&nameOf(m)===name):undefined;
          if(method&&out){
            const traced=trace(cls,method,scoped),body=method.getText();
            const arrayMove=/\b(?:moveItemInArray|transferArrayItem)\s*\(/.test(body);
            if(traced.bindings.length||traced.stateful||arrayMove){
              const issues:string[]=[];
              const draggables=allElements(node.children).filter(el=>el.attributes.some(a=>a.name.toLowerCase()==='cdkdrag'));
              if(draggables.length!==1)issues.push('CDK drop lists need exactly one authored draggable item template');
              const item=draggables[0];
              const handles=item?allElements(item.children).filter(el=>el.attributes.some(a=>a.name.toLowerCase()==='cdkdraghandle')):[];
              if(handles.length>1)issues.push('CDK dragging needs one unambiguous authored drag handle');
              const idBinding=node.inputs.find(i=>i.name==='id')?.value;
              const idExpression=idBinding instanceof ASTWithSource?idBinding.source??'':'';
              const staticId=!idExpression?attr(node,'id'):undefined;
              const member=/^(?:this\.)?(\w+)$/.exec(idExpression)?.[1];
              const idMember=member?cls.members.find(m=>nameOf(m)===member):undefined;
              const idType=idMember?project.checker.getTypeAtLocation(idMember):undefined;
              const literalTypes=idType?.isUnion()?idType.types:idType?[idType]:[];
              const identifiers=literalTypes.flatMap(t=>t.flags&ts.TypeFlags.StringLiteral?[(t as ts.StringLiteralType).value]:[]);
              const suffix=member&&member!=='id'?member[0].toUpperCase()+member.slice(1):'ContainerId';
              const sourceContext=staticId?undefined:`source${suffix}`,targetParam=`target${suffix}`;
              const idSchema:Schema={type:'string',minLength:1,...identifiers.length?{enum:[...new Set(identifiers)]}:{}};
              const orientationBinding=node.inputs.find(i=>i.name==='cdkDropListOrientation')?.value;
              const orientation=attr(node,'cdkDropListOrientation')??(orientationBinding instanceof ASTWithSource&&typeof (orientationBinding.ast as {value?:unknown}).value==='string'?String((orientationBinding.ast as {value:string}).value):'vertical');
              if(!['vertical','horizontal'].includes(orientation))issues.push('CDK dragging requires a static vertical or horizontal orientation');
              const delayBinding=item?.inputs.find(i=>i.name==='cdkDragStartDelay')?.value;
              const delayRaw=attr(item??node,'cdkDragStartDelay')??(delayBinding instanceof ASTWithSource?(delayBinding.ast as {value?:unknown}).value:undefined);
              const delay=delayRaw===undefined?0:Number(delayRaw);
              if(!Number.isFinite(delay)||delay<0||delay>2000)issues.push('CDK drag start delay must be statically bounded to 2000 milliseconds');
              const itemAttribute=item&&(attr(item,'data-id')!==undefined||item.inputs.some(i=>['data-id','attr.data-id'].includes(i.name)))?'data-id':item&&(attr(item,'data-key')!==undefined||item.inputs.some(i=>['data-key','attr.data-key'].includes(i.name)))?'data-key':item&&(attr(item,'id')!==undefined||item.inputs.some(i=>i.name==='id'))?'id':undefined;
              const listSelector=`${componentSelector} ${selectorFor(node)}.cdk-drop-list`;
              const itemSelector=item?`${selectorFor(item)}.cdk-drag`:'.cdk-drag';
              const modes:('reorder'|'transfer')[]=['reorder',.../\.previousContainer\b/.test(body)&&/\.container\b/.test(body)?['transfer' as const]:[]];
              for(const mode of modes){
                const properties:Record<string,Schema>={previousIndex:{type:'integer',minimum:0},currentIndex:{type:'integer',minimum:0},...mode==='transfer'?{[targetParam]:idSchema}:{}};
                const before=capabilities.length;
                pushDriven(nameOf(method),method,{...traced,stateful:traced.stateful||arrayMove},{drag:{mode,listSelector,itemSelector,...staticId?{sourceId:staticId}:{sourceContext},...mode==='transfer'?{targetParam}:{},previousIndex:'previousIndex',currentIndex:'currentIndex',orientation:orientation==='horizontal'?'horizontal':'vertical',...handles[0]?{handleSelector:selectorFor(handles[0])}:{},...itemAttribute?{itemAttribute}:{},...delay?{startDelayMs:delay}:{}}},listSelector,`${mode==='transfer'?'Move':'Reorder'} items${sourceContext?` (required source context: ${sourceContext})`:''}`,'cdkDropListDropped',{type:'object',properties,required:Object.keys(properties),additionalProperties:false},{file:template.file,line:out.sourceSpan.start.line+template.lineOffset+1});
                if(capabilities.length>before){const cap=capabilities.at(-1)!;cap.id+=`:${mode}`;cap.issues.push(...issues);if(cap.issues.length)cap.status='blocked';if(sourceContext)cap.contextSchema={type:'object',properties:{[sourceContext]:idSchema},required:[sourceContext],additionalProperties:true};}
              }
            }
          }
        }
        if (node.name === 'mat-paginator') {
          const out = node.outputs.find(o => o.name === 'page');
          const name = out && handlerCall(out.handler);
          const method = name ? cls.members.find((m): m is ts.MethodDeclaration => ts.isMethodDeclaration(m) && nameOf(m) === name) : undefined;
          const sizesText = node.inputs.find(i => i.name === 'pageSizeOptions')?.value;
          const sizes = sizesText instanceof ASTWithSource ? (staticTemplateValues(project,cls,sizesText.source??'')??[]).filter((v):v is number=>typeof v==='number'&&Number.isInteger(v)&&v>0) : [];
          if (method && out && sizes.length) {
            const selector = `${componentSelector} mat-paginator`;
            const eventParam=method.parameters[0]&&ts.isIdentifier(method.parameters[0].name)?method.parameters[0].name.text:'event';
            const traced=trace(cls,method,scoped);
            const sentAs=traced.bindings.flatMap(b=>b.arguments.map((a,index)=>a===`${eventParam}.pageIndex`&&typeof b.inputSchema==='object'?Object.keys((b.inputSchema as {properties?:object}).properties??{})[index]:undefined)).find(Boolean);
            const pageParam=sentAs??'page';
            pushDriven(nameOf(method), method, traced, { paginator: { selector, page: pageParam, pageSize: 'pageSize', sizes } }, selector, 'Change page', 'page',
              { type: 'object', properties: { [pageParam]: { type: 'integer', minimum: 0 }, pageSize: { type: 'integer', enum: sizes } }, required: [pageParam, 'pageSize'], additionalProperties: false },
              { file: template.file, line: out.sourceSpan.start.line + template.lineOffset + 1 });
          }
        }
        if (node.name === 'input' && attr(node, 'type') === 'file') {
          const out = node.outputs.find(o => o.name === 'change');
          const name = out && handlerCall(out.handler);
          const method = name ? cls.members.find((m): m is ts.MethodDeclaration => ts.isMethodDeclaration(m) && nameOf(m) === name) : undefined;
          if (method && out) {
            const selector = `${componentSelector} ${selectorFor(node)}`;
            const part = { type: 'string', minLength: 1 } as Schema;
            pushDriven(nameOf(method), method, trace(cls, method, scoped), { file: { selector, param: 'file' } }, selector, 'Choose file', 'change',
              { type: 'object', properties: { file: { type: 'object', properties: { name: part, mimeType: part, base64: { type: 'string', minLength: 1, maxLength: 7_000_000 } as Schema }, required: ['name', 'mimeType', 'base64'], additionalProperties: false } }, required: ['file'], additionalProperties: false },
              { file: template.file, line: out.sourceSpan.start.line + template.lineOffset + 1 });
          }
        }
        // Material tab groups and sortable tables report their change through an output; drive them through their headers.
        if (node.name === 'mat-tab-group') {
          const out = node.outputs.find(o => o.name === 'selectedIndexChange' || o.name === 'selectedTabChange');
          const name = out && handlerCall(out.handler);
          const method = name ? cls.members.find((m): m is ts.MethodDeclaration => ts.isMethodDeclaration(m) && nameOf(m) === name) : undefined;
          const traced = method && trace(cls, method, scoped);
          if (method && out && traced && (traced.bindings.length || traced.stateful)) {
            const selector = `${componentSelector} mat-tab-group`;
            const count = node.children.filter(c => c instanceof TmplAstElement && c.name === 'mat-tab').length;
            pushDriven(nameOf(method), method, traced, { tabs: { selector, param: 'index' } }, selector, 'Select tab', out.name,
              { type: 'object', properties: { index: { type: 'integer', minimum: 0, ...(count ? { maximum: count - 1 } : {}) } }, required: ['index'], additionalProperties: false },
              { file: template.file, line: out.sourceSpan.start.line + template.lineOffset + 1 });
          }
        }
        if (node.attributes.some(a => a.name.toLowerCase() === 'matsort')) {
          const out = node.outputs.find(o => o.name === 'matSortChange');
          const name = out && handlerCall(out.handler);
          const method = name ? cls.members.find((m): m is ts.MethodDeclaration => ts.isMethodDeclaration(m) && nameOf(m) === name) : undefined;
          const traced = method && trace(cls, method, scoped);
          if (method && out && traced && (traced.bindings.length || traced.stateful)) {
            const columns = allElements(parsed.nodes).filter(e => attr(e, 'matColumnDef') !== undefined && allElements(e.children).some(c => c.attributes.some(a => a.name.toLowerCase() === 'mat-sort-header'))).map(e => attr(e, 'matColumnDef')!);
            const selector = `${componentSelector} [matsort]`;
            pushDriven(nameOf(method), method, traced, { sort: { selector, param: 'direction', columnParam: 'active', ...(columns.length ? { columns } : {}) } }, selector, 'Sort', out.name,
              { type: 'object', properties: { active: columns.length ? { type: 'string', enum: columns } : { type: 'string', minLength: 1 }, direction: { type: 'string', enum: ['asc', 'desc', ''] } }, required: ['active', 'direction'], additionalProperties: false },
              { file: template.file, line: out.sourceSpan.start.line + template.lineOffset + 1 });
          }
        }
        // Value-change handlers: a select, checkbox or toggle whose (change)/(selectionChange) handler does the work.
        const textLike = (node.name === 'input' && !['checkbox', 'radio', 'file', 'hidden', 'button', 'submit'].includes(attr(node, 'type') ?? 'text')) || node.name === 'textarea';
        if (['select', 'mat-select', 'mat-checkbox', 'mat-slide-toggle', 'input', 'textarea', 'mat-button-toggle-group', 'mat-radio-group'].includes(node.name) && (node.name !== 'input' || ['checkbox', 'radio'].includes(attr(node, 'type') ?? '') || textLike)) {
          for (const out of node.outputs.filter(o => o.name === 'change' || o.name === 'selectionChange' || o.name === 'valueChange' || (textLike && (o.name === 'input' || o.name === 'ngModelChange')))) {
            const name = handlerCall(out.handler);
            const method = name ? cls.members.find((m): m is ts.MethodDeclaration => ts.isMethodDeclaration(m) && nameOf(m) === name) : undefined;
            if (!method) continue;
            const traced = trace(cls, method, scoped);
            if (!traced.bindings.length && !traced.stateful) continue;
            const handlerParam = method.parameters[0] && ts.isIdentifier(method.parameters[0].name) ? method.parameters[0].name.text : 'value';
            const modelRef = node.inputs.find(i => i.name === 'ngModel')?.value;
            const modelLeaf = modelRef instanceof ASTWithSource ? modelRef.source?.split('.').at(-1) : undefined;
            // The public name is the key the value is sent under (`dispatch(change({ theme: event.value }))` -> theme).
            const sentAs = traced.bindings.flatMap(b => b.arguments).map(a => new RegExp(`(\\w+)\\s*:\\s*${handlerParam}(?:\\.\\w+)?\\b`).exec(a)?.[1]).find(Boolean);
            // A bare event parameter (`e`, `event`) says nothing; name the value after its control instead.
            const eventLike = /^(e|ev|evt|event|\$event|change|args)$/i.test(handlerParam);
            const param = sentAs ?? (textLike && modelLeaf ? modelLeaf : eventLike ? (modelLeaf ?? attr(node, 'name') ?? (['mat-checkbox', 'mat-slide-toggle'].includes(node.name) || (node.name === 'input' && !textLike) ? 'checked' : 'value')) : handlerParam);
            const boolean = ['mat-checkbox', 'mat-slide-toggle'].includes(node.name) || (node.name === 'input' && !textLike);
            const info = optionInfo(node);
            const choiceGroup = node.name === 'mat-button-toggle-group' || node.name === 'mat-radio-group';
            if (choiceGroup) {
              const choices = allElements(node.children).filter(c => c.name === 'mat-button-toggle' || c.name === 'mat-radio-button');
              info.values = choices.flatMap(c => { const v = attr(c, 'value'); return v === undefined ? [] : [v]; });
              info.dynamic = choices.some(c => c.inputs.some(i => i.name === 'value')) || info.values.length !== choices.length;
            }
            const resolvedValues = info.dynamic ? resolveLoopOptions(project, cls, node) : undefined;
            if (resolvedValues) { info.values = resolvedValues; info.dynamic = false; }
            const where = locator(node, parsed.nodes);
            const inferred: Schema = boolean ? { type: 'boolean' } : info.values.length && !info.dynamic ? { type: 'string', enum: info.values } : { type: 'string' };
            const schema=constrainHandlerInput(inferred,handlerConstraints(method,traced.bindings.map(b=>b.method)).get(handlerParam));
            const field: Field = { name: param, selector: where.selector, ...(where.label ? { label: where.label } : {}), element: node.name, type: boolean ? 'checkbox' : 'text', required: true, supported: true, schema,
              adapter: choiceGroup ? 'material-choice' : node.name === 'mat-select' ? 'material-select' : node.name === 'mat-checkbox' ? 'material-checkbox' : node.name === 'mat-slide-toggle' ? 'material-toggle' : 'native',
              ...(node.name === 'select' || node.name === 'mat-select') && (!info.values.length || info.dynamic) ? { dynamicOptions: true } : {} };
            const routeParams = routeParamsOf(scope.path);
            const issues: string[] = [];
            if (repeated&&!hostTarget) issues.push('Repeated/template-scoped UI requires an explicit row selection binding');
            if (scope.path.includes('*')) issues.push('Wildcard routes require an explicit navigation binding');
            capabilities.push({ id: `${scope.path}#${nameOf(cls)}.${nameOf(method)}:${componentSelector} ${selectorFor(node)}`, fingerprint: '', route: scope.path, ...(routeParams.length ? { routeParams } : {}), ...(hostTarget?{target:hostTarget}:{}),component: nameOf(cls), componentSelector,
              action: { owner: componentSelector, kind: 'workflow', selector: componentSelector, label: `Set ${param}`, event: out.name, expression: out.handler instanceof ASTWithSource ? out.handler.source ?? '' : '', source: { file: template.file, line: out.sourceSpan.start.line + template.lineOffset + 1 } },
              plan: { mode: 'edit', root: componentSelector,...(hostTarget?{targetRoot:componentSelector}:{}), repeats: [] }, fields: [field],
              handler: nameOf(method), callPath: traced.paths.flat(), bindings: traced.bindings, ...(traced.bindings.length ? {} : { effectKind: 'ui-state' as const }),
              inputSchema: withRouteParams({ type: 'object', properties: { [param]: schema }, required: [param], additionalProperties: false }, [...routeParams,...hostTarget?[hostTarget.param]:[]],hostTarget),
              outputSchema: { type: 'object', properties: { status: { const: 'ui-dispatched' }, url: { type: 'string' } }, required: ['status', 'url'], additionalProperties: false },
              guards: [...scope.guards], workflow: { confirmation: 'not-observed', evidence: [] }, issues, status: issues.length ? 'blocked' : 'candidate' });
          }
        }
        // Forwarded component events: a child's @Output/output() that the parent handles. The real UI action is the
        // element inside the child that emits it; the capability belongs to the parent handler that does the work.
        const hostMatches=matchingComponents(selectors,node);
        const hostChild = hostMatches.length===1?hostMatches[0]:undefined;
        const hostTrackedTarget=hostChild?trackedDisplayIdentity(project,cls,parsed.nodes,node,hostChild):undefined;
        const widget=hostChild&&counterWidget(project,hostChild);
        const counterEvents=new Set<string>();
        if(widget){
          const event=node.outputs.find(o=>o.name===widget.output);
          const call=event?.handler instanceof ASTWithSource&&event.handler.ast instanceof Call?event.handler.ast:undefined;
          const receiver=call?.receiver;
          if(call&&receiver instanceof PropertyRead&&receiver.receiver instanceof PropertyRead&&receiver.receiver.receiver instanceof ImplicitReceiver){
            const fieldName=receiver.receiver.name,methodName=receiver.name,field=cls.members.find((m):m is ts.PropertyDeclaration=>ts.isPropertyDeclaration(m)&&nameOf(m)===fieldName);
            const src=event!.handler instanceof ASTWithSource?event!.handler.source??'':'';
            const traced=field&&trace(cls,field,scoped,{receiver:fieldName,method:methodName,arguments:call.args.map(a=>src.slice(a.span.start,a.span.end))});
            const binding=traced?.bindings.find(b=>b.method===methodName),inputs=typeof binding?.inputSchema==='object'?(binding.inputSchema as {properties?:Record<string,Schema>;required?:string[]}).properties??{}:{};
            const rootParam=Object.keys(inputs)[0],dto=inputs[rootParam] as {properties?:Record<string,Schema>;required?:string[]}|undefined;
            const literal=call.args[0] as unknown as {keys?:{key:string}[];values?:unknown[]};
            if(traced&&binding&&dto?.properties&&literal.keys&&literal.values){
              const eventIndex=literal.values.findIndex(value=>value instanceof PropertyRead&&value.receiver instanceof ImplicitReceiver&&value.name==='$event');
              const valueKey=literal.keys[eventIndex]?.key;
              const sourcePath=(a:unknown):{path:string[];signals:string[]}|undefined=>{if(a instanceof PropertyRead){if(a.receiver instanceof ImplicitReceiver){const member=cls.members.find(m=>ts.isPropertyDeclaration(m)&&nameOf(m)===a.name);if(member&&ts.isPropertyDeclaration(member)&&/^input\b/.test(member.initializer?.getText()??''))return {path:[a.name],signals:[]};}const base=sourcePath(a.receiver);return base?{...base,path:[...base.path,a.name]}:undefined;}if(a instanceof Call&&!a.args.length&&a.receiver instanceof PropertyRead){const base=sourcePath(a.receiver);return base?{...base,signals:[...base.signals,base.path.join('.')]}:undefined;}return;};
              const identity=literal.values.flatMap((value,index)=>{const path=sourcePath(value);return path?[{...path,key:literal.keys![index].key}]:[];});
              if(valueKey&&identity.length===1){
                const schema:Schema={type:'object',properties:{[rootParam]:{...dto,properties:{...dto.properties,[valueKey]:{type:'integer',...(widget.minimum!==undefined?{minimum:widget.minimum}:{})}}}},required:[rootParam],additionalProperties:false};
                const target:NonNullable<Capability['target']>={param:rootParam,source:'component',path:identity[0].path,signals:identity[0].signals,valuePath:[identity[0].key],inputSchema:(schema as {properties:Record<string,Schema>}).properties[rootParam],keepInput:true};
                const actionSelector=`${componentSelector} ${selectorFor(node)}`,routeParams=routeParamsOf(scope.path);
                capabilities.push({id:`${scope.path}#${nameOf(cls)}.${fieldName}.${methodName}:${actionSelector}`,fingerprint:'',route:scope.path,...(routeParams.length?{routeParams}:{}),component:nameOf(cls),componentSelector,action:{owner:componentSelector,kind:'workflow',selector:actionSelector,label:`Set ${valueKey}`,event:event!.name,expression:src,source:{file:template.file,line:event!.sourceSpan.start.line+template.lineOffset+1}},target,drive:{counter:{param:rootParam,path:[valueKey],...widget.binding}},fields:[],handler:`${fieldName}.${methodName}`,callPath:traced.paths.flat(),bindings:traced.bindings,inputSchema:withRouteParams(schema,routeParams),outputSchema:{type:'object',properties:{status:{const:'ui-dispatched'},url:{type:'string'}},required:['status','url'],additionalProperties:false},guards:[...scope.guards],workflow:{confirmation:'not-observed',evidence:[]},issues:[],status:'candidate'});
                counterEvents.add(event!.name);
              }
            }
          }
        }
        if (hostChild) for (const event of node.outputs) {
          if(counterEvents.has(event.name))continue;
          if (['click', 'ngSubmit', 'submit'].includes(event.name)) continue;
          const isOutput = hostChild.members.some(m => ts.isPropertyDeclaration(m) && nameOf(m) === event.name && (!!ts.getDecorators(m)?.some(d => d.getText().startsWith('@Output')) || /^output\b/.test(m.initializer?.getText() ?? '')));
          if (!isOutput) continue;
          const found: Call[] = [];
          class Found extends RecursiveAstVisitor { override visitCall(ast: Call, context: unknown) { if (ast.receiver instanceof PropertyRead && ast.receiver.receiver instanceof ImplicitReceiver && ast.receiver.name !== '$any') found.push(ast); return super.visitCall(ast, context); } }
          event.handler.visit(new Found());
          if (found.length !== 1) continue;
          const parentName = (found[0].receiver as PropertyRead).name;
          const parentHandler = cls.members.find((m): m is ts.MethodDeclaration => ts.isMethodDeclaration(m) && nameOf(m) === parentName);
          if (!parentHandler) continue;
          const traced = trace(cls, parentHandler, scoped);
          if (!traced.bindings.length) continue;
          const childTemplate = project.template(hostChild);
          if (!childTemplate) continue;
          const childParsed = parseTemplate(childTemplate.text, childTemplate.file);
          const emitters = allElements(childParsed.nodes).filter(el => el.outputs.some(o => {
            if (!['click','ngSubmit','submit'].includes(o.name) || !(o.handler instanceof ASTWithSource)) return false;
            const src = o.handler.source ?? '';
            if (src.includes(`${event.name}.emit(`)) return true;
            const m = /^(\w+)\(/.exec(src);
            const method = m && hostChild.members.find(x => ts.isMethodDeclaration(x) && nameOf(x) === m[1]);
            return !!method && method.getText().includes(`this.${event.name}.emit(`);
          }));
          if(emitters.length===1&&emitters[0].name==='form'){
            discover(hostChild,scoped,new Set(stack),repeated,true,dialogCtx,{output:event.name,component:nameOf(cls),handler:parentName,bindings:traced.bindings,paths:traced.paths});
            continue;
          }
          const issues: string[] = [];
          if (emitters.length !== 1) issues.push(`Forwarded event ${event.name} needs exactly one emitting UI element (found ${emitters.length})`);
          // Which data item does the handler act on? Its first parameter's property used in the service call.
          const p0 = parentHandler.parameters[0];
          let target: Capability['target']=hostTrackedTarget;
          if (p0 && ts.isIdentifier(p0.name)) {
            const entity = p0.name.text;
            const used = traced.bindings.flatMap(b => b.arguments).map(a => new RegExp(`^${entity}\\.(\\w+)$`).exec(a)?.[1]).find(Boolean);
            if (used) {
              const idLike = /^_?id$/i.test(used);
              const param = idLike && routeParamsOf(scope.path).length ? `${entity}Id` : used.replace(/^_+/, '');
              const property = project.checker.getTypeAtLocation(p0).getProperty(used);
              const type = property && project.checker.getTypeOfSymbolAtLocation(property, p0);
              const numeric = !!type && !!(type.flags & ts.TypeFlags.Number);
              target = { param, source: 'context', path: [used], ...(numeric ? { integer: true, minimum: idLike ? 1 : 0 } : {}) };
            }
          }
          if (!target) issues.push('Forwarded event needs a data identity for the item it acts on');
          if (scope.path.includes('*')) issues.push('Wildcard routes require an explicit navigation binding');
          if (scoped.uncertain) issues.push('Dynamic providers require review before code generation');
          const emitter = emitters[0];
          const hostSelector = `${componentSelector} ${selectorFor(node)}${emitter ? ' ' + selectorFor(emitter) : ''}`;
          const label = emitter ? (attr(emitter, 'aria-label') ?? childTemplate.text.slice(emitter.startSourceSpan.end.offset, emitter.endSourceSpan?.start.offset ?? emitter.sourceSpan.end.offset).replace(/<[^>]*>|{{[\s\S]*?}}/g, ' ').replace(/\s+/g, ' ').trim()) || parentName : parentName;
          const routeParams = routeParamsOf(scope.path);
          const source = { file: template.file, line: event.sourceSpan.start.line + template.lineOffset + 1 };
          capabilities.push({ id: `${scope.path}#${nameOf(cls)}.${parentName}:${hostSelector}`, fingerprint: '', route: scope.path, ...(routeParams.length ? { routeParams } : {}), ...(target ? { target } : {}), component: nameOf(cls), componentSelector,
            action: { owner: node.name, kind: 'button', selector: hostSelector, label, event: event.name, expression: event.handler instanceof ASTWithSource ? event.handler.source ?? '' : '', source }, fields: [],
            handler: parentName, callPath: traced.paths.flat(), bindings: traced.bindings,
            inputSchema: withRouteParams({ type: 'object', properties: {}, required: [], additionalProperties: false }, [...new Set([...routeParams, ...(target ? [target.param] : [])])], target),
            outputSchema: { type: 'object', properties: { status: { const: 'ui-dispatched' }, url: { type: 'string' } }, required: ['status','url'], additionalProperties: false },
            guards: [...scope.guards], workflow: { confirmation: traced.confirmation.length ? 'observed' : 'not-observed', evidence: traced.confirmation },
            issues, status: issues.length ? 'blocked' : 'candidate' });
        }
        const children = matchingComponents(selectors,node);
        if (children?.length === 1) discover(children[0], scoped, stack, repeated, true, dialogCtx,undefined,hostInputsFor(project,cls,children[0],node,parsed.nodes,hostInputs),hostTrackedTarget);
      }
      const n = node as unknown as { children?: HtmlNode[]; branches?: { children: HtmlNode[] }[]; cases?: { children: HtmlNode[] }[]; groups?: { children: HtmlNode[] }[] };
      // `*ngIf="x as y"` and `@if (...; as y)` declare variables too, but only ngFor/@for repeat their content.
      // Anything that stamps its content with a per-item context (ngFor, matCellDef rows, ng-template let-x) is loop-like; ngIf-as is not.
      const isNgFor = node instanceof TmplAstTemplate && (node.templateAttrs.some(a => a.name === 'ngFor' || a.name === 'ngForOf') || (node.variables.length > 0 && !node.templateAttrs.some(a => a.name === 'ngIf' || a.name === 'ngIfElse')));
      const dynamic = repeated || isNgFor || node.constructor.name.includes('ForLoopBlock');
      const own = isNgFor && node instanceof TmplAstTemplate ? node.variables.filter(v => v.value === '' || v.value === '$implicit').map(v => v.name) : node.constructor.name.includes('ForLoopBlock') ? [(node as unknown as { item: { name: string } }).item.name] : [];
      const next = dynamic ? [...loops, ...own, ...(loops.length || own.length ? [] : ['*'])] : loops;
      for (const child of n.children ?? []) visit(child, next);
      let taken=false;
      for(const branch of n.branches??[]){const expression=(branch as unknown as {expression?:{source?:string|null}|null}).expression?.source;const known=expression?fold(expression):undefined;
        if(taken||known===false)continue;if(known===true||!expression)taken=true;
        for(const child of branch.children)visit(child,next);
      }
      for(const branch of [...n.cases??[],...n.groups??[]])for(const child of branch.children)visit(child,next);
    }
    parsed.nodes.forEach(n => visit(n));
    // Static RouterLinks remain ordinary anchor clicks, including the application's existing guards.
    const links=staticRouterLinks(project,cls,parsed.nodes,componentSelector,selectorFor);
    if(links){
      const routeParams=routeParamsOf(scope.path),issues:string[]=[];
      if(scope.path.includes('*'))issues.push('Wildcard routes require an explicit navigation binding');
      if(scoped.uncertain)issues.push('Dynamic providers require review before code generation');
      capabilities.push({id:`${scope.path}#${nameOf(cls)}.navigate:${componentSelector} a[routerlink]`,fingerprint:'',route:scope.path,...routeParams.length?{routeParams}:{},component:nameOf(cls),componentSelector,
        action:{owner:componentSelector,kind:'workflow',selector:componentSelector,label:'Navigate through authored links',event:'click',expression:'routerLink',source:links.source},drive:links.drive,fields:[],handler:'navigate',callPath:[],bindings:[],effectKind:'ui-state',
        inputSchema:withRouteParams(links.inputSchema,routeParams),outputSchema:{type:'object',properties:{status:{const:'ui-dispatched'},url:{type:'string'}},required:['status','url'],additionalProperties:false},guards:[...scope.guards],workflow:{confirmation:'not-observed',evidence:[]},issues,status:issues.length?'blocked':'candidate'});
    }
    // List queries: a method that reads the state of Material paginator/sort/search widgets (ViewChild) and loads data from it.
    const widgetFields = new Map<string, 'paginator' | 'sort' | 'search'>();
    const searchRefs = new Map<string, string>();
    for (const m of cls.members) {
      if (!ts.isPropertyDeclaration(m)) continue;
      for (const d of ts.getDecorators(m) ?? []) {
        if (!ts.isCallExpression(d.expression) || d.expression.expression.getText() !== 'ViewChild') continue;
        const a0 = d.expression.arguments[0]?.getText() ?? '';
        if (a0 === 'MatPaginator') widgetFields.set(nameOf(m), 'paginator');
        else if (a0 === 'MatSort') widgetFields.set(nameOf(m), 'sort');
        else if (/^['"]\w+['"]$/.test(a0)) { widgetFields.set(nameOf(m), 'search'); searchRefs.set(nameOf(m), a0.slice(1, -1)); }
      }
    }
    if (widgetFields.size >= 2) for (const m of cls.members) {
      if (!ts.isMethodDeclaration(m) || !publicMethod(m) || /^ng[A-Z]/.test(nameOf(m))) continue;
      const text = m.getText();
      const uses = (field: string, prop: string) => new RegExp(`this\\.${field}\\.${prop}\\b`).test(text);
      const pg = [...widgetFields].find(([, k]) => k === 'paginator')?.[0], so = [...widgetFields].find(([, k]) => k === 'sort')?.[0], se = [...widgetFields].find(([, k]) => k === 'search')?.[0];
      const reads = { page: !!pg && uses(pg, 'pageIndex'), pageSize: !!pg && uses(pg, 'pageSize'), sort: !!so && uses(so, 'direction'), filter: !!se && new RegExp(`this\\.${se}\\.nativeElement\\.value`).test(text) };
      if (Object.values(reads).filter(Boolean).length < 2) continue;
      const all = allElements(parsed.nodes);
      const paginatorEl = all.find(e => e.name === 'mat-paginator');
      const sortEl = all.find(e => e.attributes.some(a => a.name.toLowerCase() === 'matsort'));
      const searchEl = se ? all.find(e => e.references.some(r => r.name === searchRefs.get(se))) : undefined;
      const sizesText = paginatorEl?.inputs.find(i => i.name === 'pageSizeOptions')?.value;
      const sizes = sizesText instanceof ASTWithSource ? (sizesText.source?.match(/\d+/g) ?? []).map(Number) : [];
      const drive: NonNullable<Capability['drive']> = {
        ...(reads.page || reads.pageSize) && paginatorEl ? { paginator: { selector: `${componentSelector} mat-paginator`, page: reads.page ? 'page' : undefined, pageSize: reads.pageSize ? 'pageSize' : undefined, sizes } } : {},
        ...reads.sort && sortEl ? { sort: { selector: `${componentSelector} [matsort]`, param: 'sort' } } : {},
        ...reads.filter && searchEl ? { search: { selector: `${componentSelector} ${selectorFor(searchEl)}`, param: 'filter' } } : {},
      };
      const properties: Record<string, Schema> = {
        ...drive.search ? { filter: { type: 'string' } } : {}, ...drive.sort ? { sort: { type: 'string', enum: ['asc', 'desc'] } } : {},
        ...drive.paginator?.page ? { page: { type: 'integer', minimum: 0 } } : {}, ...drive.paginator?.pageSize ? { pageSize: sizes.length ? { type: 'integer', enum: sizes } : { type: 'integer', minimum: 1 } } : {} };
      const routeParams = routeParamsOf(scope.path);
      capabilities.push({ id: `${scope.path}#${nameOf(cls)}.${nameOf(m)}:${componentSelector}`, fingerprint: '', route: scope.path, ...(routeParams.length ? { routeParams } : {}), component: nameOf(cls), componentSelector,
        action: { kind: 'workflow', selector: componentSelector, label: 'Filter, sort or paginate', event: 'widget', expression: `${nameOf(m)}()`, source: project.ref(m) }, fields: [], drive,
        handler: nameOf(m), callPath: [`${nameOf(cls)}.${nameOf(m)}`], bindings: [],
        inputSchema: withRouteParams({ type: 'object', properties, required: [], additionalProperties: false }, routeParams),
        outputSchema: { type: 'object', properties: { status: { const: 'ui-dispatched' }, url: { type: 'string' } }, required: ['status', 'url'], additionalProperties: false },
        guards: [...scope.guards], workflow: { confirmation: 'not-observed', evidence: [] }, issues: [], status: 'candidate' });
    }
    // Page-load actions: ngOnInit reads query parameters (a signed link) and calls a service whose success has a visible outcome.
    const init = cls.members.find((m): m is ts.MethodDeclaration => ts.isMethodDeclaration(m) && nameOf(m) === 'ngOnInit');
    if (init) {
      const text = init.getText();
      const notParams = new Set(['subscribe', 'pipe', 'get', 'getAll', 'has', 'keys', 'forEach', 'map']);
      const names = [...new Set([...text.matchAll(/queryParams\[['"](\w+)['"]\]|queryParams\.(\w+)(?![\w(])|queryParamMap\.get\(['"](\w+)['"]\)/g)].map(m => m[1] ?? m[2] ?? m[3]))].filter(n => !notParams.has(n));
      const traced = trace(cls, init, scoped);
      const templateReads=new Set<string>();
      class Reads extends RecursiveAstVisitor {override visitPropertyRead(ast:PropertyRead,context:unknown){if(ast.receiver instanceof ImplicitReceiver)templateReads.add(ast.name);return super.visitPropertyRead(ast,context);}}
      const viewReads=(node:any)=>{if(node.value instanceof ASTWithSource)node.value.visit(new Reads());for(const input of node.inputs??[])if(input.value instanceof ASTWithSource)input.value.visit(new Reads());for(const child of node.children??[])viewReads(child);for(const branch of [...node.branches??[],...node.cases??[],...node.groups??[]])for(const child of branch.children??[])viewReads(child);};parsed.nodes.forEach(viewReads);
      let visibleServiceResult=false;
      const deps=injected(cls);
      const inspectResult=(node:ts.Node)=>{
        if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken&&ts.isPropertyAccessExpression(node.left)&&node.left.expression.kind===ts.SyntaxKind.ThisKeyword&&templateReads.has(node.left.name.text)){
          const findCall=(part:ts.Node)=>{
            if(ts.isParenthesizedExpression(part)||ts.isAsExpression(part)||ts.isNonNullExpression(part)){findCall(part.expression);return;}
            if(ts.isConditionalExpression(part)){findCall(part.condition);findCall(part.whenTrue);findCall(part.whenFalse);return;}
            if(ts.isBinaryExpression(part)&&part.operatorToken.kind===ts.SyntaxKind.CommaToken){findCall(part.right);return;}
            // An arbitrary wrapper can discard its arguments. Only a directly used traced service result proves dependence.
            if(ts.isCallExpression(part)&&ts.isPropertyAccessExpression(part.expression)&&ts.isPropertyAccessExpression(part.expression.expression)&&part.expression.expression.expression.kind===ts.SyntaxKind.ThisKeyword){const callee=part.expression,token=deps.get(part.expression.expression.name.text);if(token&&traced.bindings.some(b=>b.token===nameOf(token)&&b.method===callee.name.text))visibleServiceResult=true;}
          };findCall(node.right);
        }ts.forEachChild(node,inspectResult);
      };inspectResult(init);
      const outcome = visibleServiceResult||/(next:\s*(\([^)]*\))?\s*=>|\.then\s*\(\s*(\([^)]*\))?\s*=>)\s*\{[\s\S]*?(\.success\(|\.navigate\()/.test(text);
      if (names.length && traced.bindings.length && outcome) {
        const issues: string[] = [];
        if (scope.path.includes('*')) issues.push('Wildcard routes require an explicit navigation binding');
        const routeParams = routeParamsOf(scope.path);
        capabilities.push({ id: `${scope.path}#${nameOf(cls)}.ngOnInit:${componentSelector}`, fingerprint: '', route: scope.path, ...(routeParams.length ? { routeParams } : {}), queryParams: names, component: nameOf(cls), componentSelector,
          action: { kind: 'navigation', selector: componentSelector, label: `Open ${scope.path} with ${names.join(', ')}`, event: 'init', expression: 'ngOnInit', source: project.ref(init) }, fields: [],
          handler: 'ngOnInit', callPath: traced.paths.flat(), bindings: traced.bindings,
          inputSchema: withRouteParams({ type: 'object', properties: Object.fromEntries(names.map(n => [n, { type: 'string', minLength: 1 }])), required: names, additionalProperties: false }, routeParams),
          outputSchema: { type: 'object', properties: { status: { const: 'ui-dispatched' }, url: { type: 'string' } }, required: ['status', 'url'], additionalProperties: false },
          guards: [...scope.guards], workflow: { confirmation: 'not-observed', evidence: [] }, issues, status: issues.length ? 'blocked' : 'candidate' });
      }
    }
    for(const {form,effect} of localFormEffects(project,cls)){
      const roots=allElements(parsed.nodes).filter(el=>el.inputs.some(i=>i.name==='formGroup'&&i.value instanceof ASTWithSource&&i.value.source===form));
      if(roots.length!==1)continue;
      const bound=controls(project,cls,roots[0].children);
      const reactive=enforces(form)?formRules(cls,form,false):new Map<string,Rules>();
      for(const f of bound.fields){const r=reactive.get(f.name);if(!r)continue;f.required=f.required||!!r.required;f.schema=constrain(f.schema as {[k:string]:unknown},r,!!r.required);}
      const issues=[...bound.issues];if(scope.path.includes('*'))issues.push('Wildcard routes require an explicit navigation binding');
      const handler=`edit_${form}`;const id=`${scope.path}#${nameOf(cls)}.${handler}:${componentSelector}`;
      capabilities.push({id,fingerprint:'',route:scope.path,...(routeParamsOf(scope.path).length?{routeParams:routeParamsOf(scope.path)}:{}),component:nameOf(cls),componentSelector,
        action:{kind:'workflow',selector:componentSelector,label:`Edit ${form} and save draft`,event:'valueChanges',expression:`${form}.valueChanges → localStorage.setItem(${JSON.stringify(effect.key)})`,source:effect.source},
        plan:{mode:'edit',root:componentSelector,repeats:bound.repeats,effect},fields:bound.fields,handler,callPath:[`${nameOf(cls)}.${form}.valueChanges`,'localStorage.setItem'],bindings:[],
        inputSchema:withRouteParams({...schemaForControls(bound.fields,bound.repeats,bound.rules,true) as object,minProperties:1},routeParamsOf(scope.path)),
        outputSchema:{type:'object',properties:{status:{const:'ui-dispatched'},url:{type:'string'}},required:['status','url'],additionalProperties:false},guards:[...scope.guards],workflow:{confirmation:'not-observed',evidence:[]},issues,status:issues.length?'blocked':'candidate'});
    }
  }
  for (const route of routes) discover(route.component, route);
  // The bootstrapped shell is present on every route, so its actions are scoped to the application root.
  const routed = new Set(routes.map(r => r.component));
  const shells = new Set<ts.ClassDeclaration>();
  for (const file of project.files) {
    const scan = (n: ts.Node) => {
      if (ts.isCallExpression(n) && n.expression.getText() === 'bootstrapApplication') { const c = project.classAt(n.arguments[0]); if (c) shells.add(c); }
      if (ts.isClassDeclaration(n)) for (const e of project.array(project.property(project.metadata(n, 'NgModule'), 'bootstrap')) ?? []) { const c = project.classAt(e); if (c) shells.add(c); }
      ts.forEachChild(n, scan);
    };
    scan(file);
  }
  const beforeShells = capabilities.length;
  for (const shell of shells) if (!routed.has(shell)) discover(shell, { path: '/', guards: [], providers: new Map(), uncertain: false });
  for (const c of capabilities.slice(beforeShells)) if (c.action.kind !== 'navigation') c.global = true; // a navigation capability needs its own URL and query
  const sourceDigest = project.digest();
  for(const capability of capabilities)if(capability.action.kind!=='navigation'&&layoutChildren.get(capability.route)?.size)capability.allowedRoutes=[...layoutChildren.get(capability.route)!].filter(path=>path!==capability.route).sort();
  // Identical ids can come from the same component hosted in different contexts; the most conservative duplicate wins.
  const byId = new Map<string, Capability>();
  for (const c of capabilities) { const seen = byId.get(c.id); if (!seen || (seen.status === 'candidate' && c.status === 'blocked')) byId.set(c.id, c); }
  const unique = [...byId.values()].sort((a,b) => a.id.localeCompare(b.id));
  for (const capability of unique) capability.fingerprint = hash(JSON.stringify({ sourceDigest, capability }));
  // Schema failures in legacy services are retained as evidence, never turned into permissive schemas.
  return { formatVersion: 1, compilerVersion: '0.1.0', sourceDigest,
    routes: routes.map(r => ({ path: r.path, component: nameOf(r.component), guards: r.guards })).sort((a,b) => a.path.localeCompare(b.path)),
    capabilities: unique, diagnostics };
}

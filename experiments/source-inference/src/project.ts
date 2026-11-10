import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import {hash} from './hash.js';
export {hash} from './hash.js';
import type { SourceRef } from './model.js';

export const nameOf = (node: ts.Node & { name?: ts.Node }) => node.name?.getText().replace(/^['"]|['"]$/g, '') ?? '';
export const publicMethod = (node: ts.Node): node is ts.MethodDeclaration => ts.isMethodDeclaration(node) &&
  !node.modifiers?.some(m => [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword, ts.SyntaxKind.StaticKeyword].includes(m.kind)) &&
  !ts.isPrivateIdentifier(node.name);
export type SourceCallable = ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration;

export class Project {
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly root: string;
  readonly files: ts.SourceFile[];
  readonly classes: ts.ClassDeclaration[] = [];
  readonly extraFiles = new Map<string, string>();

  constructor(config: string) {
    const path = resolve(config);
    this.root = dirname(path);
    const input = ts.readConfigFile(path, ts.sys.readFile);
    if (input.error) throw new Error(ts.flattenDiagnosticMessageText(input.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(input.config, ts.sys, this.root, { noEmit: true, ignoreDeprecations: '6.0' });
    if (parsed.errors.length) throw new Error(parsed.errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
    this.program = ts.createProgram(parsed.fileNames, parsed.options);
    this.checker = this.program.getTypeChecker();
    this.files = this.program.getSourceFiles().filter(f => !f.isDeclarationFile && !f.fileName.includes('/node_modules/'));
    for (const f of this.files) {
      const visit = (n: ts.Node) => { if (ts.isClassDeclaration(n)) this.classes.push(n); ts.forEachChild(n, visit); };
      visit(f);
    }
    const syntax = this.program.getSyntacticDiagnostics();
    if (syntax.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(syntax, {
      getCurrentDirectory: () => this.root, getCanonicalFileName: f => f, getNewLine: () => '\n',
    }));
  }

  ref(node: ts.Node): SourceRef {
    const file = node.getSourceFile();
    return { file: this.path(file.fileName), line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1 };
  }
  path(path: string) { return relative(this.root, path).replaceAll('\\', '/'); }
  symbol(node: ts.Node): ts.Symbol | undefined {
    let symbol = this.checker.getSymbolAtLocation(node);
    if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) symbol = this.checker.getAliasedSymbol(symbol);
    return symbol;
  }
  declaration(node: ts.Node): ts.Declaration | undefined {
    return this.symbol(node)?.valueDeclaration ?? this.symbol(node)?.declarations?.[0];
  }
  unwrap(node: ts.Expression, seen = new Set<ts.Node>()): ts.Expression {
    if (seen.has(node)) return node;
    seen.add(node);
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) return this.unwrap(node.expression, seen);
    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
      const declaration = this.declaration(node);
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) return this.unwrap(declaration.initializer, seen);
    }
    return node;
  }
  object(node?: ts.Expression): ts.ObjectLiteralExpression | undefined {
    if (!node) return;
    const value = this.unwrap(node);
    return ts.isObjectLiteralExpression(value) ? value : undefined;
  }
  property(object: ts.ObjectLiteralExpression | undefined, name: string): ts.Expression | undefined {
    const prop = object?.properties.find(p => nameOf(p) === name);
    if (prop && ts.isPropertyAssignment(prop)) return prop.initializer;
    if (prop && ts.isShorthandPropertyAssignment(prop)) return prop.name;
  }
  /** A string known at analysis time: literals, templates and concatenations of them, and constants/enum members/`as const` objects. */
  string(node?: ts.Expression, depth = 0): string | undefined {
    if (!node || depth > 8) return;
    const value = this.unwrap(node);
    if (ts.isStringLiteralLike(value)) return value.text;
    if (ts.isTemplateExpression(value)) {
      let out = value.head.text;
      for (const span of value.templateSpans) { const part = this.string(span.expression, depth + 1); if (part === undefined) return; out += part + span.literal.text; }
      return out;
    }
    if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = this.string(value.left, depth + 1), right = this.string(value.right, depth + 1);
      return left !== undefined && right !== undefined ? left + right : undefined;
    }
    if (ts.isIdentifier(value) || ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) {
      // The checker knows literal types of `as const` objects, string enums and const declarations.
      const type = this.checker.getTypeAtLocation(value);
      if (type.flags & ts.TypeFlags.StringLiteral) return (type as ts.StringLiteralType).value;
      const declaration = this.declaration(ts.isElementAccessExpression(value) ? value.argumentExpression : ts.isPropertyAccessExpression(value) ? value.name : value);
      // Only constants: a `let`, or a property that something else may reassign, is not a known value.
      const constant = !!declaration && (ts.isEnumMember(declaration)
        || (ts.isVariableDeclaration(declaration) && !!(declaration.parent.flags & ts.NodeFlags.Const))
        || (ts.isPropertyDeclaration(declaration) && !!declaration.modifiers?.some(m => m.kind === ts.SyntaxKind.ReadonlyKeyword))
        || (ts.isPropertyAssignment(declaration) && (() => { let n: ts.Node | undefined = declaration; while (n && !ts.isVariableDeclaration(n)) n = n.parent; return !!n && !!(n.parent.flags & ts.NodeFlags.Const); })()));
      const init = declaration && constant && (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration) || ts.isPropertyDeclaration(declaration) || ts.isEnumMember(declaration)) ? declaration.initializer : undefined;
      if (init && init !== value) return this.string(init, depth + 1);
    }
    return undefined;
  }
  array(node?: ts.Expression): ts.Expression[] | undefined {
    if (!node) return;
    const value = this.unwrap(node);
    if (!ts.isArrayLiteralExpression(value)) return;
    return value.elements.flatMap(e => ts.isSpreadElement(e) ? this.array(e.expression) ?? [e] : [e]);
  }
  angularFunction(node: ts.Node, name: string): boolean {
    const symbol = this.symbol(node);
    return symbol?.name === name && !!symbol.declarations?.some(d => /[/\\]@angular[/\\]core[/\\]/.test(d.getSourceFile().fileName));
  }
  metadata(cls: ts.ClassDeclaration, name: string): ts.ObjectLiteralExpression | undefined {
    for (const d of ts.getDecorators(cls) ?? []) {
      if (ts.isCallExpression(d.expression) && this.angularFunction(d.expression.expression, name)) return this.object(d.expression.arguments[0]);
    }
  }
  hasDecorator(cls: ts.ClassDeclaration, name: string): boolean {
    return (ts.getDecorators(cls) ?? []).some(d => ts.isCallExpression(d.expression) && this.angularFunction(d.expression.expression, name));
  }
  isService(cls: ts.ClassDeclaration): boolean {
    return this.hasDecorator(cls,'Injectable') || this.hasDecorator(cls,'Service');
  }
  classAt(node?: ts.Expression): ts.ClassDeclaration | undefined {
    if (!node) return;
    const value = this.unwrap(node);
    const declaration = this.declaration(value);
    return declaration && ts.isClassDeclaration(declaration) ? declaration : undefined;
  }
  /** An actual constructor-valued const used as an Angular injection token (for example signalStore(...)). */
  injectableFactoryAt(node?:ts.Expression):ts.VariableDeclaration|undefined{
    if(!node)return;
    const declaration=this.declaration(node);
    if(!declaration||!ts.isVariableDeclaration(declaration)||!declaration.initializer||!(declaration.parent.flags&ts.NodeFlags.Const)||declaration.getSourceFile().isDeclarationFile)return;
    const initializer=this.unwrap(declaration.initializer);
    if(!ts.isCallExpression(initializer)||!this.checker.getTypeAtLocation(node).getConstructSignatures().length)return;
    return declaration;
  }
  /** Resolve a checked factory instance method back to its authored callable; never use a d.ts or method name as proof. */
  factoryMethod(token:ts.VariableDeclaration,name:string):SourceCallable|undefined{
    const signatures=this.checker.getTypeAtLocation(token.name).getConstructSignatures();
    const declarations=signatures.flatMap(signature=>this.checker.getReturnTypeOfSignature(signature).getProperty(name)?.declarations??[]);
    const source=declarations.filter(d=>!d.getSourceFile().isDeclarationFile&&!d.getSourceFile().fileName.includes('/node_modules/'));
    for(const declaration of source){
      if(ts.isMethodDeclaration(declaration)&&publicMethod(declaration)&&declaration.body)return declaration;
      if(ts.isPropertyAssignment(declaration)||ts.isPropertyDeclaration(declaration)){
        if(ts.isPropertyDeclaration(declaration)&&declaration.modifiers?.some(m=>[ts.SyntaxKind.PrivateKeyword,ts.SyntaxKind.ProtectedKeyword,ts.SyntaxKind.StaticKeyword].includes(m.kind)))continue;
        if(!declaration.initializer)continue;
        const value=this.unwrap(declaration.initializer);
        if(ts.isArrowFunction(value)||ts.isFunctionExpression(value))return value;
        // NgRx signalMethod exposes a callable around its typed source callback.
        if(ts.isCallExpression(value)&&this.symbol(value.expression)?.name==='signalMethod'&&this.symbol(value.expression)?.declarations?.some(d=>d.getSourceFile().fileName.includes('/@ngrx/signals/'))){
          const callback=value.arguments[0];if(callback&&(ts.isArrowFunction(callback)||ts.isFunctionExpression(callback)))return callback;
        }
      }
    }
  }
  template(cls: ts.ClassDeclaration): { text: string; file: string; lineOffset: number } | undefined {
    const meta = this.metadata(cls, 'Component');
    const inline = this.property(meta, 'template');
    const text = this.string(inline);
    if (text !== undefined && inline) return { text, file: this.ref(inline).file, lineOffset: this.ref(inline).line - 1 };
    const url = this.string(this.property(meta, 'templateUrl'));
    if (!url) return;
    const file = resolve(dirname(cls.getSourceFile().fileName), url);
    let contents: string;
    try { contents = readFileSync(file, 'utf8'); } catch { return; }
    this.extraFiles.set(file, contents);
    return { text: contents, file: this.path(file), lineOffset: 0 };
  }
  digest() {
    const entries = [...this.files.map(f => [this.path(f.fileName), f.text]), ...[...this.extraFiles].map(([p,t]) => [this.path(p),t])];
    return hash(JSON.stringify(entries.sort((a,b) => a[0].localeCompare(b[0]))));
  }
}

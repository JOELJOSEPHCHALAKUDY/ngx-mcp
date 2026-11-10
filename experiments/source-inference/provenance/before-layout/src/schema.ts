import ts from 'typescript';
import type { Schema } from './model.js';
import { nameOf } from './project.js';

export class SchemaCompiler {
  readonly issues: string[] = [];
  constructor(private checker: ts.TypeChecker) {}
  fail(type: ts.Type, reason: string): Schema {
    this.issues.push(`${reason}: ${this.checker.typeToString(type)}`);
    return false;
  }
  type(type: ts.Type, seen = new Set<ts.Type>()): Schema {
    if (seen.has(type)) return this.fail(type, 'Recursive type needs an explicit schema');
    const next = new Set(seen).add(type);
    const flags = type.flags;
    if (flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter)) return this.fail(type, 'Unresolved type');
    if (flags & ts.TypeFlags.Never) return false;
    if (flags & ts.TypeFlags.StringLiteral) return { type: 'string', const: (type as ts.StringLiteralType).value };
    if (flags & ts.TypeFlags.NumberLiteral) return { type: 'number', const: (type as ts.NumberLiteralType).value };
    if (flags & ts.TypeFlags.BooleanLiteral) return { type: 'boolean', const: (type as ts.Type & { intrinsicName: string }).intrinsicName === 'true' };
    if (flags & ts.TypeFlags.String) return { type: 'string' };
    if (flags & ts.TypeFlags.Number) return { type: 'number' };
    if (flags & ts.TypeFlags.Boolean) return { type: 'boolean' };
    if (flags & (ts.TypeFlags.Null | ts.TypeFlags.Void | ts.TypeFlags.Undefined)) return { type: 'null' };
    if (type.isUnion()) {
      const types = type.types.filter(t => !(t.flags & ts.TypeFlags.Undefined));
      if (types.length === 1) return this.type(types[0], next);
      const schemas = types.map(t => this.type(t, next));
      if (schemas.every(s => typeof s === 'object' && s.type === 'boolean')) return { type: 'boolean' };
      return { anyOf: schemas };
    }
    if (this.checker.isArrayType(type)) return { type: 'array', items: this.type(this.checker.getTypeArguments(type as ts.TypeReference)[0], next) };
    if (this.checker.isTupleType(type)) return this.fail(type, 'Tuple serialization is not supported');
    const symbol = type.getSymbol();
    const name = symbol?.name;
    if (name === 'Promise' || name === 'Observable') {
      const arg = this.checker.getTypeArguments(type as ts.TypeReference)[0];
      return arg ? this.type(arg, next) : this.fail(type, 'Missing asynchronous value type');
    }
    if (type.getCallSignatures().length || ['Date', 'File', 'Blob', 'Map', 'Set', 'Event'].includes(name ?? '')) return this.fail(type, 'Non-JSON type');
    if (flags & ts.TypeFlags.Object) {
      const properties: Record<string, Schema> = {};
      const required: string[] = [];
      for (const property of type.getProperties()) {
        const declaration = property.valueDeclaration ?? property.declarations?.[0];
        if (!declaration) return this.fail(type, 'Property declaration unavailable');
        if (ts.isMethodDeclaration(declaration) || ts.isMethodSignature(declaration)) return this.fail(type, 'Object has callable members');
        properties[property.name] = this.type(this.checker.getTypeOfSymbolAtLocation(property, declaration), next);
        if (!(property.flags & ts.SymbolFlags.Optional)) required.push(property.name);
      }
      const index = this.checker.getIndexTypeOfType(type, ts.IndexKind.String);
      return { type: 'object', properties, required, additionalProperties: index ? this.type(index, next) : false };
    }
    return this.fail(type, 'Unsupported type');
  }
  method(method: ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration) {
    const properties: Record<string, Schema> = {};
    const required: string[] = [];
    for (const [index,p] of method.parameters.entries()) {
      if (p.dotDotDotToken) {
        this.issues.push('Rest parameters need an explicit binding');
        continue;
      }
      // The argument is still one typed object when its callee destructures it; a positional key preserves provenance.
      const name=ts.isIdentifier(p.name)?nameOf(p):`arg${index}`;
      properties[name] = this.type(this.checker.getTypeAtLocation(p));
      if (!p.questionToken && !p.initializer) required.push(name);
    }
    const signature = this.checker.getSignatureFromDeclaration(method);
    const outputSchema = signature ? this.type(this.checker.getReturnTypeOfSignature(signature)) : false;
    return { inputSchema: { type: 'object', properties, required, additionalProperties: false } as Schema, outputSchema, issues: this.issues };
  }
}

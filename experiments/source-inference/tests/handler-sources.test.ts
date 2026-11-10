import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {Ajv} from 'ajv';
import {handlerConstraints,constrainHandlerInput} from '../src/handler-constraints.js';
function method(body:string){const source=ts.createSourceFile('fixture.ts',`class Fixture{run(raw:string){${body}}}`,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);return (source.statements[0] as ts.ClassDeclaration).members[0] as ts.MethodDeclaration;}
const ajv=new Ajv({strict:false});
test('explicit signal source expressions carry immutable aliases into trimmed bounds',()=>{
 const patches=handlerConstraints(method('const value=this.draft().trim();if(value.length<3||value.length>8)return;this.api.save(value);'),['save'],new Map([['this.draft()','displayName']]));
 const accepts=ajv.compile(constrainHandlerInput({type:'string'},patches.get('displayName')));assert(accepts('  abc  '));assert(accepts('12345678'));assert(!accepts(' a '));assert(!accepts('123456789'));
});
test('source expressions stop constraining the caller after a direct reassignment',()=>{
 const patches=handlerConstraints(method('this.email="replacement";if(this.email.length<4)return;this.api.save(this.email);'),['save'],new Map([['this.email','email']]));assert.equal(patches.size,0);
});
test('signal writes before a guard do not impose that guard on the former UI value',()=>{
 const patches=handlerConstraints(method('this.draft.set("replacement");if(this.draft().length<4)return;this.api.save(this.draft());'),['save'],new Map([['this.draft()','name']]));assert.equal(patches.size,0);
});
test('negated unflagged literal test guards preserve the authored regex exactly',()=>{
 const pattern='^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$';
 const patches=handlerConstraints(method(`const address=this.email;if(!/${pattern}/.test(address))return;this.api.save(address);`),['save'],new Map([['this.email','email']]));assert.deepEqual(patches.get('email'),{pattern});
 const accepts=ajv.compile(constrainHandlerInput({type:'string',pattern:'^.+@.+$'},patches.get('email')));assert(accepts('person@example.test'));assert(!accepts('person@example'));assert(!accepts(' person@example.test'));
});
test('flagged, positive, and transformed test guards never guess a raw input regex',()=>{
 for(const condition of ['!/abc/i.test(raw)','!/abc/g.test(raw)','/abc/.test(raw)','!/abc/.test(raw.trim())'])assert.equal(handlerConstraints(method(`if(${condition})return;this.api.save(raw);`),['save']).get('raw'),undefined);
});
test('necessary reject disjunctions combine every source regex with earlier patterns',()=>{
 const patch=handlerConstraints(method('if(!/^a/.test(raw)||!/z$/.test(raw))return;this.api.save(raw);'),['save']).get('raw');
 const accepts=ajv.compile(constrainHandlerInput({type:'string',pattern:'^.{3,}$',allOf:[{maxLength:5}]},patch));assert(accepts('abz'));assert(!accepts('az'));assert(!accepts('xbz'));assert(!accepts('aba'));assert(!accepts('abcdefz'));
});
test('an AND rejection does not impose either regex independently',()=>{
 assert.equal(handlerConstraints(method('if(!/^a/.test(raw)&&!/z$/.test(raw))return;this.api.save(raw);'),['save']).size,0);
});

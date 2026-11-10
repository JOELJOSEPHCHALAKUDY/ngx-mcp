import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {Ajv} from 'ajv';
import {handlerConstraints,constrainHandlerInput} from '../src/handler-constraints.js';

function constraints(body:string){
  const source=ts.createSourceFile('guards.ts',`class Example {save(text:string,count:number,payload:{title:string}){${body}}}`,ts.ScriptTarget.Latest,true);
  const cls=source.statements[0] as ts.ClassDeclaration;
  return handlerConstraints(cls.members[0] as ts.MethodDeclaration,['persist']);
}
test('early returns constrain scalar and nested inputs before the business effect',()=>{
  const rules=constraints('if(count<2 || count>8)return;if(payload.title.length<=3)return;this.writer.persist();');
  assert.deepEqual(rules.get('count'),{minimum:2,maximum:8});
  assert.deepEqual(rules.get('payload.title'),{minLength:4});
});
test('trimmed source guards accept padded values and reject too short or long cores',()=>{
  const patch=constraints('const cleaned=text.trim();if(cleaned.length<2 || cleaned.length>4)return;this.writer.persist();').get('text');
  const valid=new Ajv().compile(constrainHandlerInput({type:'string'},patch));
  for(const value of ['ab','a b','abcd','  abcd  ','\n ab \t'])assert(valid(value),JSON.stringify(value));
  for(const value of ['',' ','a',' a ','abcde'])assert(!valid(value),JSON.stringify(value));
});
test('conjunction rejections and post-effect guards do not invent bounds',()=>{
  assert.equal(constraints('if(count<2 && text.length<3)return;this.writer.persist();if(count>8)return;').size,0);
});
test('reassigned inputs and mutable aliases do not constrain the caller value',()=>{
  assert.equal(constraints('count=4;if(count<2)return;this.writer.persist();').size,0);
  assert.equal(constraints('let copy=text;copy="fixed";if(copy.length<2)return;this.writer.persist();').size,0);
  assert.equal(constraints('payload.title="fixed";if(payload.title.length<2)return;this.writer.persist();').size,0);
});
test('independent template patterns survive combination with a source guard',()=>{
  const schema=constrainHandlerInput({type:'string',pattern:'^[A-Z ]+$'},constraints('if(text.trim().length<2)return;this.writer.persist();').get('text'));
  const valid=new Ajv().compile(schema);assert(valid(' AB '));assert(!valid(' A '));assert(!valid(' ab '));
});

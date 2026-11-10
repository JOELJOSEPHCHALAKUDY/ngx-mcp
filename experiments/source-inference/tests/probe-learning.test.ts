import test from 'node:test';
import assert from 'node:assert/strict';
import {learnFieldConstraints,repeatsOperation,type MembershipQuery} from '../src/probe-learning.js';
function oracle(accept:(value:unknown)=>boolean,budget=100){let count=0;const query:MembershipQuery=async value=>count>=budget?undefined:(count++,accept(value));return {query,spent:()=>count};}
test('length search starts from the accepted value and finds a narrow range below ten',async()=>{
 const q=oracle(v=>typeof v==='string'&&v.length>=2&&v.length<=4);
 assert.deepEqual((await learnFieldConstraints({type:'string'},'aaa',q.query)).patch,{minLength:2,maxLength:4});
});
test('a large minimum anchors maximum search at an accepted length',async()=>{
 const q=oracle(v=>typeof v==='string'&&v.length>=37&&v.length<=52);
 assert.deepEqual((await learnFieldConstraints({type:'string'},'a'.repeat(40),q.query)).patch,{minLength:37,maxLength:52});
});
test('an unanswered budget-limited boundary never becomes a guessed maximum',async()=>{
 const q=oracle(v=>typeof v==='string'&&v.length>=2&&v.length<=51,5);
 const result=await learnFieldConstraints({type:'string'},'a'.repeat(10),q.query);
 assert.equal(q.spent(),5);assert.equal(result.patch.maxLength,undefined);assert(result.uncertainties.length>0);
});
test('budget exhaustion during integer bisection does not publish a midpoint',async()=>{
 const q=oracle(v=>typeof v==='number'&&Number.isInteger(v)&&v>=-13&&v<=23,7);
 const result=await learnFieldConstraints({type:'integer'},1,q.query);
 assert.equal(q.spent(),7);assert.equal(result.patch.minimum,undefined);assert.equal(result.patch.maximum,undefined);
});
test('integer boundaries and negative limits are learned only after convergence',async()=>{
 const q=oracle(v=>typeof v==='number'&&Number.isInteger(v)&&v>=-13&&v<=23);
 assert.deepEqual((await learnFieldConstraints({type:'number'},1,q.query)).patch,{type:'integer',minimum:-13,maximum:23});
});
test('rejecting one fraction at the upper boundary does not assert integer-only input',async()=>{
 const q=oracle(v=>typeof v==='number'&&v>=0&&v<=1);
 assert.deepEqual((await learnFieldConstraints({type:'number'},1,q.query)).patch,{});
});
test('empty optional strings are not excluded by an unconditional minimum',async()=>{
 const q=oracle(v=>typeof v==='string'&&(v===''||v.length>=3&&v.length<=8));
 const result=await learnFieldConstraints({type:'string'},'aaaa',q.query);
 assert.equal(result.patch.minLength,undefined);assert.equal(result.patch.maxLength,8);assert(result.uncertainties.some(x=>x.includes('Empty is accepted')));
});
test('format-sensitive fields do not acquire an invented complete email regex',async()=>{
 const q=oracle(v=>typeof v==='string'&&v.includes('@'));
 const result=await learnFieldConstraints({type:'string'},'a@b',q.query);
 assert.equal(result.patch.pattern,undefined);assert.equal(result.patch.maxLength,undefined);assert(result.uncertainties.some(x=>x.includes('regular expression')));
});
test('membership needs the baseline operation, not just a validation call or audit write',()=>{
 const baseline={http:[{method:'POST',path:'/validate'},{method:'POST',path:'/orders'}],storage:['audit'],calls:[{method:'clear'},{method:'create'}]};
 assert(!repeatsOperation(baseline,{http:[{method:'POST',path:'/validate'}],storage:['audit'],calls:[{method:'clear'}]}));
 assert(repeatsOperation(baseline,baseline));
 assert(!repeatsOperation({http:[{method:'OPTIONS',path:'/orders'}],storage:[],calls:[]},{http:[{method:'OPTIONS',path:'/orders'}],storage:[],calls:[]}));
});

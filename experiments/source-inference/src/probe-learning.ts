import type {Schema} from './model.js';

/** Undefined means no answer (for example budget exhaustion), never rejection. */
export type MembershipQuery = (value: unknown, note: string) => Promise<boolean | undefined>;
export interface ConstraintLearning { patch: Record<string, unknown>; uncertainties: string[] }

/** Interleave independent learners while the application itself is queried strictly one operation at a time. */
export async function learnFieldsConstraints(
  fields: {name:string;schema:Schema;current:unknown}[],
  ask: (name:string,value:unknown,note:string)=>Promise<boolean|undefined>,
): Promise<Record<string,ConstraintLearning>> {
  type Pending={value:unknown;note:string;answer:(value:boolean|undefined)=>void};
  const pending:(Pending|undefined)[]=fields.map(()=>undefined);
  const results:Record<string,ConstraintLearning>={};
  let completed=0,cursor=0,wake:(()=>void)|undefined,failed:unknown;
  const notify=()=>{wake?.();wake=undefined;};
  const tasks=fields.map((field,index)=>learnFieldConstraints(field.schema,field.current,(value,note)=>new Promise(resolve=>{
    pending[index]={value,note,answer:resolve};notify();
  })).then(result=>{results[field.name]=result;completed++;notify();},error=>{failed??=error;completed++;notify();}));
  while(completed<fields.length){
    let index=-1;
    for(let offset=0;offset<fields.length;offset++)if(pending[(cursor+offset)%fields.length]){index=(cursor+offset)%fields.length;break;}
    if(index===-1){await new Promise<void>(resolve=>{wake=resolve;});continue;}
    const query=pending[index]!;pending[index]=undefined;cursor=(index+1)%fields.length;
    let answer:boolean|undefined;
    if(!failed)try{answer=await ask(fields[index].name,query.value,query.note);}catch(error){failed=error;}
    query.answer(answer);
    // Let the answered learner enqueue its next query before choosing the next field.
    await Promise.resolve();
  }
  await Promise.all(tasks);
  if(failed)throw failed;
  return results;
}

/**
 * Learn bounded, witnessed hypotheses around a known accepted value. A boundary is only emitted when an accepted
 * and rejected query meet at adjacent lengths/integers. No midpoint or budget-truncated estimate becomes a limit.
 * These membership observations describe client dispatch, not backend acceptance or a proof of the entire domain.
 * A bound the schema already states is confirmed with two queries, and the far end of the search range is asked first,
 * because a field without a limit is the common case and should not cost a whole search.
 */
export async function learnFieldConstraints(schema: Schema, current: unknown, query: MembershipQuery): Promise<ConstraintLearning> {
  const prop = typeof schema === 'object' ? schema as Record<string, any> : {};
  const patch: Record<string, unknown> = {}, uncertainties: string[] = [];
  // The accepted baseline and repeated boundary values need not consume the shared application-query budget again.
  const answers=new Map<string,boolean>([[JSON.stringify(current)??'undefined',true]]);
  const ask:MembershipQuery=async(value,note)=>{const key=JSON.stringify(value)??'undefined';if(answers.has(key))return answers.get(key);const answer=await query(value,note);if(answer!==undefined)answers.set(key,answer);return answer;};
  if (typeof current === 'boolean') {
    if (!Object.hasOwn(prop,'const')) {
      const accepted = await ask(!current, 'opposite boolean');
      if (accepted === false) patch.const = current;
    }
    return {patch,uncertainties};
  }
  if (typeof current === 'number' && Number.isFinite(current)) {
    if (!Number.isInteger(current)) return {patch,uncertainties:['Continuous numeric bounds are not inferred from an integer search.']};
    // A rejection beyond a numeric boundary does not establish that all fractions are invalid.
    const above = await ask(current + 0.5, 'fractional above baseline');
    const below = above === undefined ? undefined : await ask(current - 0.5, 'fractional below baseline');
    const discrete = prop.type === 'integer' || above === false && below === false;
    if (!discrete) return {patch,uncertainties:['Fractional values or an unanswered query prevent inference of integer bounds.']};
    if (above === false && below === false) patch.type='integer';
    for (const direction of [-1,1]) {
      const key=direction<0?'minimum':'maximum',stated=prop[key];
      let good=current, bad:number|undefined, unanswered=false;
      if(Number.isSafeInteger(stated)&&(stated-current)*direction>=0){
        const at=await ask(stated,`number ${stated}`),beyond=at?await ask(stated+direction,`number ${stated+direction}`):at;
        if(at===undefined||beyond===undefined){uncertainties.push('Numeric boundary query budget exhausted.');continue;}
        if(at&&!beyond){patch[key]=stated;continue;}
        if(at)good=stated+direction;else bad=stated;
      }
      if(bad===undefined){
        const far=current+direction*1_048_576,ok=await ask(far,`number ${far}`);
        if(ok===undefined){uncertainties.push('Numeric boundary query budget exhausted.');continue;}
        if(ok){uncertainties.push('Numeric boundary not found within the search range.');continue;}
      }
      const start=good;
      for(let step=1;bad===undefined&&step<=1_048_576;step*=2){
        const value=start+direction*step, ok=await ask(value,`number ${value}`);
        if(ok===undefined){unanswered=true;break;}
        if(ok)good=value;else{bad=value;break;}
      }
      if(bad===undefined){uncertainties.push(unanswered?'Numeric boundary query budget exhausted.':'Numeric boundary not found within the search range.');continue;}
      while(Math.abs(bad-good)>1){
        const value=Math.floor((bad+good)/2),ok=await ask(value,`number ${value}`);
        if(ok===undefined){unanswered=true;break;}
        if(ok)good=value;else bad=value;
      }
      if(!unanswered&&Math.abs(bad-good)===1)patch[direction<0?'minimum':'maximum']=good;
      else uncertainties.push('Numeric boundary remained unverified when the query budget ran out.');
    }
    return {patch,uncertainties};
  }
  if (typeof current !== 'string' || prop.enum || !current.length) return {patch,uncertainties};
  const empty = await ask('','empty string');
  if(empty===undefined)return {patch,uncertainties:['String query budget exhausted.']};
  // For a format-sensitive field a valid baseline is not evidence that arbitrary strings of that length work.
  const anchor=current.length;
  if(anchor>4096)return {patch,uncertainties:['Accepted baseline exceeds the bounded string search.']};
  const repeated='a'.repeat(anchor);
  const plain = repeated===current ? true : await ask(repeated,`length ${anchor}`);
  if(plain!==true){
    if(empty===false&&!prop.minLength&&!prop.anyOf)patch.minLength=1;
    uncertainties.push(plain===undefined?'String query budget exhausted.':'Format-sensitive field: finite probes cannot identify its regular expression.');
    return {patch,uncertainties};
  }
  let low=0,high=anchor,minimumAnswered=true,knownMinimum=false;
  if(Number.isSafeInteger(prop.minLength)&&prop.minLength>0&&prop.minLength<=4096&&!empty){
    const at=await ask('a'.repeat(prop.minLength),`length ${prop.minLength}`);
    const below=at===undefined?undefined:await ask('a'.repeat(prop.minLength-1),`length ${prop.minLength-1}`);
    if(at===true&&below===false){high=prop.minLength;knownMinimum=true;}
    else if(at===undefined||below===undefined)minimumAnswered=false;
  }
  // Empty may be a valid optional value while short nonempty strings are invalid.
  if(empty){
    const one=anchor===1?true:await ask('a','length 1');
    if(one===undefined)minimumAnswered=false;
    else if(one)high=1;else low=1;
  }
  while(high-low>1&&minimumAnswered&&!knownMinimum){
    const length=Math.floor((low+high)/2),ok=await ask('a'.repeat(length),`length ${length}`);
    if(ok===undefined){minimumAnswered=false;break;}
    if(ok)high=length;else low=length;
  }
  if(minimumAnswered){
    if(!empty)patch.minLength=high;
    else if(high>1)uncertainties.push(`Empty is accepted; nonempty strings need at least ${high} characters. No unconditional minimum was added.`);
  }else uncertainties.push('Minimum string length remained unverified when the query budget ran out.');
  let good=anchor,bad:number|undefined,maximumAnswered=true;
  if(Number.isSafeInteger(prop.maxLength)&&prop.maxLength>=anchor&&prop.maxLength<4096){
    const at=await ask('a'.repeat(prop.maxLength),`length ${prop.maxLength}`);
    const above=at===undefined?undefined:await ask('a'.repeat(prop.maxLength+1),`length ${prop.maxLength+1}`);
    if(at===true&&above===false){good=prop.maxLength;bad=prop.maxLength+1;}
    else if(at===undefined||above===undefined)maximumAnswered=false;
    else if(at===true&&above===true)good=prop.maxLength+1;
    else if(at===false&&above===true){uncertainties.push('Non-monotone string acceptance: a maximum was not inferred.');return {patch,uncertainties};}
    else if(at===false)bad=prop.maxLength;
  }
  if(bad===undefined&&maximumAnswered&&good<4096){
    const far=await ask('a'.repeat(4096),'length 4096');
    if(far===undefined)maximumAnswered=false;else if(far)good=4096;
  }
  for(let length=Math.min(4096,Math.max(good+1,good*2));bad===undefined&&maximumAnswered&&length>good;length=Math.min(4096,length*2)){
    const ok=await ask('a'.repeat(length),`length ${length}`);
    if(ok===undefined){maximumAnswered=false;break;}
    if(ok){good=length;if(length===4096)break;}else{bad=length;break;}
  }
  if(bad!==undefined){
    while(bad-good>1){
      const length=Math.floor((good+bad)/2),ok=await ask('a'.repeat(length),`length ${length}`);
      if(ok===undefined){maximumAnswered=false;break;}
      if(ok)good=length;else bad=length;
    }
    if(maximumAnswered&&bad-good===1)patch.maxLength=good;
    else uncertainties.push('Maximum string length remained unverified when the query budget ran out.');
  }else uncertainties.push(maximumAnswered?'Maximum string length not found within 4096 characters.':'String query budget exhausted before a maximum was verified.');
  return {patch,uncertainties};
}

/** Require the baseline operation's effects, rather than accepting any validation call, log write or preflight request. */
export interface EffectEvidence {http:{method:string;path:string}[];storage:string[];calls:{method:string}[]}
const reads=/^(get|list|find|search|load|fetch|query|read|check|view|count|lookup|retrieve|select|is|has)/i;
export function operationEvidence(e:EffectEvidence):string[]{
  const writes=[...e.http.filter(h=>!['GET','HEAD','OPTIONS'].includes(h.method)).map(h=>`http:${h.method}:${h.path}`),...e.storage.map(k=>`storage:${k}`),...e.calls.filter(c=>!reads.test(c.method)).map(c=>`call:${c.method}`)];
  return [...new Set(writes.length?writes:[...e.http.filter(h=>h.method==='GET').map(h=>`http:GET:${h.path}`),...e.calls.map(c=>`call:${c.method}`)])];
}
export function repeatsOperation(baseline:EffectEvidence,observed:EffectEvidence):boolean{
  const expected=operationEvidence(baseline),actual=new Set(operationEvidence(observed));
  return expected.length>0&&expected.every(key=>actual.has(key));
}

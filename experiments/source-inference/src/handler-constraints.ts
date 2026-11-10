import ts from 'typescript';
import type {Schema} from './model.js';

/** Necessary conditions from unconditional early-return guards before a traced business call. */
export function handlerConstraints(method:ts.MethodDeclaration,effectMethods:string[],sources:ReadonlyMap<string,string>=new Map()):Map<string,Record<string,unknown>>{
  const result=new Map<string,Record<string,unknown>>();
  if(!method.body||!effectMethods.length)return result;
  type Value={key:string;trimmed:boolean;length:boolean};
  const aliases=new Map<string,Value>();
  const activeSources=new Map(sources);
  for(const p of method.parameters)if(ts.isIdentifier(p.name))aliases.set(p.name.text,{key:p.name.text,trimmed:false,length:false});
  function value(node:ts.Expression):Value|undefined{
    if(ts.isParenthesizedExpression(node)||ts.isAsExpression(node)||ts.isNonNullExpression(node))return value(node.expression);
    const source=activeSources.get(node.getText().replace(/\s+/g,''));if(source)return {key:source,trimmed:false,length:false};
    if(ts.isIdentifier(node))return aliases.get(node.text);
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='trim'&&!node.arguments.length){const v=value(node.expression.expression);return v&&!v.length?{...v,trimmed:true}:undefined;}
    if(ts.isPropertyAccessExpression(node)){const v=value(node.expression);return v?(node.name.text==='length'?{...v,length:true}:{...v,key:v.key+'.'+node.name.text}):undefined;}
    return undefined;
  }
  const bounds=new Map<string,{min?:number;max?:number;trimmed:boolean}>();
  function pattern(patch:Record<string,unknown>,source:string){
    if(!patch.pattern)patch.pattern=source;
    else if(patch.pattern!==source)patch.allOf=[...(Array.isArray(patch.allOf)?patch.allOf:[]),{pattern:source}];
  }
  function comparison(node:ts.Expression):void{
    if(ts.isParenthesizedExpression(node)){comparison(node.expression);return;}
    if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.BarBarToken){comparison(node.left);comparison(node.right);return;}
    if(ts.isPrefixUnaryExpression(node)&&node.operator===ts.SyntaxKind.ExclamationToken&&ts.isCallExpression(node.operand)){
      const call=node.operand,callee=call.expression;
      if(ts.isPropertyAccessExpression(callee)&&callee.name.text==='test'&&ts.isRegularExpressionLiteral(callee.expression)&&call.arguments.length===1){
        const text=callee.expression.text,last=text.lastIndexOf('/'),tested=value(call.arguments[0]);
        if(last===text.length-1&&tested&&!tested.trimmed&&!tested.length){const patch=result.get(tested.key)??{};pattern(patch,text.slice(1,last));result.set(tested.key,patch);}
      }
      return;
    }
    // An AND rejection does not give an independent constraint on either input.
    if(!ts.isBinaryExpression(node))return;
    let v=value(node.left),literal=node.right;let op:ts.SyntaxKind=node.operatorToken.kind;
    if(!v){v=value(node.right);literal=node.left;op=({[ts.SyntaxKind.LessThanToken]:ts.SyntaxKind.GreaterThanToken,[ts.SyntaxKind.LessThanEqualsToken]:ts.SyntaxKind.GreaterThanEqualsToken,[ts.SyntaxKind.GreaterThanToken]:ts.SyntaxKind.LessThanToken,[ts.SyntaxKind.GreaterThanEqualsToken]:ts.SyntaxKind.LessThanEqualsToken} as Record<number,ts.SyntaxKind>)[op]??op;}
    if(!v)return;
    let n:number|undefined;
    if(ts.isNumericLiteral(literal))n=Number(literal.text);
    else if(ts.isPrefixUnaryExpression(literal)&&literal.operator===ts.SyntaxKind.MinusToken&&ts.isNumericLiteral(literal.operand))n=-Number(literal.operand.text);
    if(n===undefined||!Number.isFinite(n))return;
    const patch=result.get(v.key)??{};
    if(v.length){
      if(!Number.isInteger(n))return;
      const bound=bounds.get(v.key)??{trimmed:v.trimmed};
      if(bound.trimmed!==v.trimmed)return;
      if(op===ts.SyntaxKind.LessThanToken)bound.min=Math.max(bound.min??0,n);
      else if(op===ts.SyntaxKind.LessThanEqualsToken)bound.min=Math.max(bound.min??0,n+1);
      else if(op===ts.SyntaxKind.GreaterThanToken)bound.max=Math.min(bound.max??Infinity,n);
      else if(op===ts.SyntaxKind.GreaterThanEqualsToken)bound.max=Math.min(bound.max??Infinity,n-1);
      bounds.set(v.key,bound);
    }else{
      if(op===ts.SyntaxKind.LessThanToken)patch.minimum=Math.max(Number(patch.minimum??-Infinity),n);
      else if(op===ts.SyntaxKind.LessThanEqualsToken)patch.exclusiveMinimum=Math.max(Number(patch.exclusiveMinimum??-Infinity),n);
      else if(op===ts.SyntaxKind.GreaterThanToken)patch.maximum=Math.min(Number(patch.maximum??Infinity),n);
      else if(op===ts.SyntaxKind.GreaterThanEqualsToken)patch.exclusiveMaximum=Math.min(Number(patch.exclusiveMaximum??Infinity),n);
    }
    if(Object.keys(patch).length)result.set(v.key,patch);
  }
  function reachesEffect(node:ts.Node):boolean{
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&effectMethods.includes(node.expression.name.text))return true;
    let found=false;ts.forEachChild(node,child=>{if(reachesEffect(child))found=true;});return found;
  }
  function invalidateWrites(node:ts.Node):void{
    let assigned:ts.Expression|undefined;
    if(ts.isBinaryExpression(node)&&node.operatorToken.kind>=ts.SyntaxKind.FirstAssignment&&node.operatorToken.kind<=ts.SyntaxKind.LastAssignment)assigned=node.left;
    if((ts.isPrefixUnaryExpression(node)||ts.isPostfixUnaryExpression(node))&&[ts.SyntaxKind.PlusPlusToken,ts.SyntaxKind.MinusMinusToken].includes(node.operator))assigned=node.operand;
    // Once an input (or an alias of it) is reassigned, subsequent guards do not necessarily constrain the caller's value.
    let original=assigned&&value(assigned);
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&['set','update'].includes(node.expression.name.text)){const key=activeSources.get(node.expression.expression.getText().replace(/\s+/g,'')+'()');if(key)original={key,trimmed:false,length:false};}
    if(original){for(const [name,v]of aliases)if(v.key.split('.')[0]===original.key.split('.')[0])aliases.delete(name);for(const [source,key]of activeSources)if(key.split('.')[0]===original.key.split('.')[0])activeSources.delete(source);}
    ts.forEachChild(node,invalidateWrites);
  }
  for(const statement of method.body.statements){
    if(reachesEffect(statement))break;
    // A guard's own then-body may write before returning; that does not alter its condition's input.
    if(!ts.isIfStatement(statement))invalidateWrites(statement);
    if(ts.isVariableStatement(statement)&&(statement.declarationList.flags&ts.NodeFlags.Const))for(const d of statement.declarationList.declarations)if(ts.isIdentifier(d.name)&&d.initializer){const v=value(d.initializer);if(v)aliases.set(d.name.text,v);}
    if(!ts.isIfStatement(statement))continue;
    const last=ts.isBlock(statement.thenStatement)?statement.thenStatement.statements.at(-1):statement.thenStatement;
    if(last&&(ts.isReturnStatement(last)||ts.isThrowStatement(last)))comparison(statement.expression);
    invalidateWrites(statement);
  }
  for(const [key,b]of bounds){
    const patch=result.get(key)??{};
    if(b.max!==undefined&&b.max<(b.min??0)){result.set(key,{not:{}});continue;}
    if(b.min!==undefined)patch.minLength=Math.max(0,b.min);
    if(!b.trimmed){if(b.max!==undefined)patch.maxLength=Math.max(0,b.max);}
    else{
      const min=Math.max(0,b.min??0),max=b.max;
      // Trimmed lengths constrain the non-padding core; a raw maxLength would reject valid padded input.
      if(max===0)pattern(patch,'^\\s*$');
      else if(min>=2)pattern(patch,`^\\s*\\S[\\s\\S]{${min-2},${max===undefined?'':max-2}}\\S\\s*$`);
      else{const core=max===1?'\\S':`\\S(?:[\\s\\S]{0,${max===undefined?'':max-2}}\\S)?`;pattern(patch,`^\\s*${min===0?'(?:'+core+')?':core}\\s*$`);}
    }
    result.set(key,patch);
  }
  return result;
}

export function constrainHandlerInput(schema:Schema,patch:Record<string,unknown>|undefined):Schema{
  if(!patch||!Object.keys(patch).length||typeof schema!=='object')return schema;
  const allOf=[...(Array.isArray(schema.allOf)?schema.allOf:[]),...(Array.isArray(patch.allOf)?patch.allOf:[])];
  // Keep independently authored patterns instead of overwriting one with the other.
  if(schema.pattern&&patch.pattern&&schema.pattern!==patch.pattern)return {...schema,...Object.fromEntries(Object.entries(patch).filter(([key])=>key!=='pattern')),allOf:[...allOf,{pattern:patch.pattern}]};
  return {...schema,...patch,...(allOf.length?{allOf}:{})};
}

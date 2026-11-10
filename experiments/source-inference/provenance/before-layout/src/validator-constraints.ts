import ts from 'typescript';
import {Project} from './project.js';

/** Recognize a source-authored string validator that returns null exactly for nonblank values.
 * This is a small symbolic interpreter, not execution of application code. Unknown code yields no rule.
 */
export function nonblankValidator(project:Project,invocation:ts.Expression):boolean{
  const call=project.unwrap(invocation);
  if(!ts.isCallExpression(call)||call.arguments.length)return false;
  const declaration=project.declaration(call.expression);
  if(!declaration||!ts.isFunctionDeclaration(declaration)||!declaration.body||declaration.parameters.length)return false;
  const outer=declaration.body.statements;
  if(outer.length!==1||!ts.isReturnStatement(outer[0])||!outer[0].expression)return false;
  const callback=project.unwrap(outer[0].expression);
  if(!(ts.isArrowFunction(callback)||ts.isFunctionExpression(callback))||callback.parameters.length!==1||!ts.isIdentifier(callback.parameters[0].name)||!ts.isBlock(callback.body))return false;
  const parameter=callback.parameters[0].name.text;
  type Symbolic='value'|'trim'|'length'|'blank'|'nonblank'|'valid'|'invalid'|'string'|boolean|number;
  const variables=new Map<string,Symbolic>();
  function expression(node:ts.Expression):Symbolic|undefined{
    if(ts.isParenthesizedExpression(node)||ts.isAsExpression(node)||ts.isNonNullExpression(node))return expression(node.expression);
    if(ts.isIdentifier(node))return variables.get(node.text);
    if(node.kind===ts.SyntaxKind.NullKeyword)return 'valid';
    if(ts.isObjectLiteralExpression(node)&&node.properties.length&&node.properties.every(p=>ts.isPropertyAssignment(p)&&!p.initializer.getText().includes('(')))return 'invalid';
    if(ts.isNumericLiteral(node))return Number(node.text);
    if(ts.isStringLiteralLike(node))return node.text==='string'?'string':undefined;
    if(ts.isTypeOfExpression(node)&&expression(node.expression)==='value')return 'string';
    if(ts.isPropertyAccessExpression(node)){
      if(ts.isIdentifier(node.expression)&&node.expression.text===parameter&&node.name.text==='value')return 'value';
      if(node.name.text==='length'&&expression(node.expression)==='trim')return 'length';
    }
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='trim'&&!node.arguments.length&&expression(node.expression.expression)==='value')return 'trim';
    if(ts.isPrefixUnaryExpression(node)&&node.operator===ts.SyntaxKind.ExclamationToken){const value=expression(node.operand);return value==='blank'?'nonblank':value==='nonblank'?'blank':typeof value==='boolean'?!value:undefined;}
    if(ts.isBinaryExpression(node)){
      const left=expression(node.left),right=expression(node.right),op=node.operatorToken.kind;
      if(op===ts.SyntaxKind.BarBarToken&&left==='value'&&ts.isStringLiteral(node.right)&&node.right.text==='')return 'value';
      if([ts.SyntaxKind.EqualsEqualsEqualsToken,ts.SyntaxKind.EqualsEqualsToken,ts.SyntaxKind.ExclamationEqualsEqualsToken,ts.SyntaxKind.ExclamationEqualsToken].includes(op)){
        const inverse=[ts.SyntaxKind.ExclamationEqualsEqualsToken,ts.SyntaxKind.ExclamationEqualsToken].includes(op);
        if(left==='length'&&right===0||left===0&&right==='length')return inverse?'nonblank':'blank';
        if(ts.isTypeOfExpression(node.left)&&left==='string'&&ts.isStringLiteral(node.right))return inverse?node.right.text!=='string':node.right.text==='string';
      }
    }
    if(ts.isConditionalExpression(node)){
      const condition=expression(node.condition),yes=expression(node.whenTrue),no=expression(node.whenFalse);
      if(typeof condition==='boolean')return condition?yes:no;
      if(condition==='nonblank'&&yes==='valid'&&no==='invalid'||condition==='blank'&&yes==='invalid'&&no==='valid')return 'nonblank';
    }
    return undefined;
  }
  for(const statement of callback.body.statements){
    if(ts.isVariableStatement(statement)){
      for(const d of statement.declarationList.declarations){if(!ts.isIdentifier(d.name)||d.name.text===parameter||!d.initializer)return false;const value=expression(d.initializer);if(value===undefined)return false;variables.set(d.name.text,value);}
    }else if(ts.isIfStatement(statement)&&expression(statement.expression)===false){
      // A numeric coercion branch is unreachable for the string control contract being inferred.
      if(statement.elseStatement)return false;
    }else if(ts.isReturnStatement(statement)&&statement.expression)return expression(statement.expression)==='nonblank';
    else return false;
  }
  return false;
}

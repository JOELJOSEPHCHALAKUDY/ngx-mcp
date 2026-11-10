import ts from 'typescript';
import {ASTWithSource,Call,PropertyRead,ImplicitReceiver,TmplAstElement} from '@angular/compiler';
import {allElements} from './workflow-compiler.js';
import {nameOf} from './project.js';
import type {Capability} from './model.js';
/** Recognize an authored boolean edit-mode opener; never invoke that method directly. */
export function inlineReveal(cls:ts.ClassDeclaration,nodes:unknown[],elements:TmplAstElement[],action:TmplAstElement,componentSelector:string,selectorFor:(node:TmplAstElement)=>string):Capability['reveal']|undefined{
  const candidates:{node:TmplAstElement;flag:string}[]=[];
  for(const node of elements)for(const out of node.outputs){
    if(out.name!=='click'||!(out.handler instanceof ASTWithSource)||!(out.handler.ast instanceof Call))continue;
    const call=out.handler.ast,receiver=call.receiver;if(!(receiver instanceof PropertyRead)||!(receiver.receiver instanceof ImplicitReceiver)||call.args.length!==1)continue;
    const value=(call.args[0] as unknown as {value?:unknown}).value;if(value!==true)continue;
    const method=cls.members.find((m):m is ts.MethodDeclaration=>ts.isMethodDeclaration(m)&&nameOf(m)===receiver.name);
    if(!method?.body||method.parameters.length!==1||!ts.isIdentifier(method.parameters[0].name))continue;
    const statements=method.body.statements;if(statements.length!==1||!ts.isExpressionStatement(statements[0])||!ts.isBinaryExpression(statements[0].expression))continue;
    const write=statements[0].expression;
    if(write.operatorToken.kind!==ts.SyntaxKind.EqualsToken||!ts.isPropertyAccessExpression(write.left)||write.left.expression.kind!==ts.SyntaxKind.ThisKeyword||!ts.isIdentifier(write.right)||write.right.text!==method.parameters[0].name.text)continue;
    candidates.push({node,flag:write.left.name.text});
  }
  const conditioned=candidates.filter(candidate=>{
    let proven=false;
    const visit=(node:any)=>{for(const branch of node.branches??[]){if(branch.expression?.source?.trim()===candidate.flag&&allElements(branch.children??[]).includes(action))proven=true;for(const child of branch.children??[])visit(child);}if(node.templateAttrs?.some((a:any)=>a.name==='ngIf'&&a.value?.source?.trim()===candidate.flag)&&allElements(node.children??[]).includes(action))proven=true;for(const child of node.children??[])visit(child);};
    nodes.forEach(visit);return proven;
  });
  if(conditioned.length!==1)return;
  return {kind:'inline',trigger:`${componentSelector} ${selectorFor(conditioned[0].node)}`,panel:`${componentSelector} ${selectorFor(action)}`,owner:componentSelector};
}

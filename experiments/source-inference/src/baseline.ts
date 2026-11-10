import ts from 'typescript';
import { Project, nameOf } from './project.js';

/** Reimplementation of the linked prototype's heuristics, including its failure modes. */
export function baseline(config: string) {
  const project = new Project(config);
  const map = (type: string) => type.includes('string') ? 'string' : type.includes('number') ? 'number' : type.includes('boolean') ? 'boolean' : 'object';
  return project.classes.filter(c => project.metadata(c,'Injectable')).flatMap(cls => cls.members.filter(ts.isMethodDeclaration)
    .filter(m => !nameOf(m).startsWith('ng') && !m.modifiers?.some(mod => mod.kind === ts.SyntaxKind.PrivateKeyword))
    .map(method => {
      const signature = project.checker.getSignatureFromDeclaration(method)!;
      return { id: `${nameOf(cls)}.${nameOf(method)}`, inputSchema: { type: 'object', properties: Object.fromEntries(method.parameters.map(p => [nameOf(p), { type: map(project.checker.typeToString(project.checker.getTypeAtLocation(p))) }])) }, outputSchema: { type: map(project.checker.typeToString(project.checker.getReturnTypeOfSignature(signature))) } };
    }));
}

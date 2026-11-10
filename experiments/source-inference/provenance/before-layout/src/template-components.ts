import ts from 'typescript';
import {TmplAstElement} from '@angular/compiler';
/** Match source-proven Angular element/attribute/class component selectors, never arbitrary CSS guesses. */
export function matchingComponents(selectors:Map<string,ts.ClassDeclaration[]>,node:TmplAstElement):ts.ClassDeclaration[]{
  const found=new Set<ts.ClassDeclaration>(),attributes=new Map(node.attributes.map(a=>[a.name.toLowerCase(),a.value]));
  for(const input of node.inputs)if(!attributes.has(input.name.toLowerCase()))attributes.set(input.name.toLowerCase(),'');
  const classes=new Set((attributes.get('class')??'').split(/\s+/));
  for(const [declaration,components]of selectors)for(const selector of declaration.split(',').map(s=>s.trim())){
    const tag=/^[a-zA-Z][\w-]*/.exec(selector)?.[0];let rest=tag?selector.slice(tag.length):selector;
    if(tag&&tag!==node.name)continue;
    let valid=!!tag||!!rest;
    while(rest&&valid){
      const attr=/^\[([\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]/.exec(rest);
      if(attr){const name=attr[1].toLowerCase(),value=attr[2]??attr[3]??attr[4];valid=attributes.has(name)&&(value===undefined||attributes.get(name)===value);rest=rest.slice(attr[0].length);continue;}
      const cls=/^\.([\w-]+)/.exec(rest);if(cls){valid=classes.has(cls[1]);rest=rest.slice(cls[0].length);continue;}
      valid=false;
    }
    if(valid)for(const component of components)found.add(component);
  }
  return [...found];
}

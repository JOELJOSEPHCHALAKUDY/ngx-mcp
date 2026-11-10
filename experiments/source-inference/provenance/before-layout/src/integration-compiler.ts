import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,isAbsolute,relative,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

export interface IntegrationCompilerOptions {
  /** Workspace copied by the caller. Edits never escape this directory; default is the config's directory. */
  workspaceRoot?:string;
  bridgeModuleSpecifier:string|((sourceFile:string)=>string);
  bridgeModuleExport?:string;
  attribute?:string;
  eventsAttribute?:string;
}
export interface IntegrationDiagnostic {category:'error'|'warning';code:string;message:string;file?:string;line?:number;}
export interface IntegrationDirective {name:string;file:string;selector:string|null;isComponent:boolean;inputs:{publicName:string;classPropertyName:string}[];outputs:{publicName:string;classPropertyName:string}[];}
export interface IntegrationBinding {
  name:string;expression:string;type?:string;expressionType?:string;resolved:boolean;
  consumers:{kind:'directive'|'native';name:string;file?:string;member?:string;type?:string}[];
  target?:string|null;phase?:string|null;twoWay?:boolean;
}
export interface IntegrationComponent {name:string;file:string;standalone:boolean;}
export interface IntegrationNodeContext {
  component:IntegrationComponent;resolvedDirectives:IntegrationDirective[];
  inputs:IntegrationBinding[];outputs:IntegrationBinding[];elementType?:string;
}
export interface IntegrationNode {
  id:string;tag:string;native:boolean;events:string[];
  source:{file:string;start:number;end:number;line:number;column:number;mapping?:'evaluated-template';templateExpression?:{start:number;end:number;line:number;column:number};templateSha256?:string};
  /** Source IDs are shared when the same authored resource is reused; resolved scopes stay separate. */
  contexts:IntegrationNodeContext[];resolvedDirectives:IntegrationDirective[];
  inputs:IntegrationBinding[];outputs:IntegrationBinding[];
  formId?:string;repeated:boolean;viewPath:{kind:string;file:string;start:number;mapping?:'evaluated-template';templateExpressionStart?:number}[];
}
export interface IntegrationEdit {file:string;beforeSha256:string;content:string;}
export interface IntegrationPlan {
  formatVersion:1;configPath:string;projectRoot:string;valid:boolean;
  angularVersion:string;typescriptVersion:string;compilerCliVersion:string;
  toolchain:{compilerCli:string;typescript:string;angularCompiler:string};
  nodes:IntegrationNode[];edits:IntegrationEdit[];diagnostics:IntegrationDiagnostic[];
}
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const slash=(path:string)=>path.replaceAll('\\','/');
const nativeTags=new Set(['input','select','textarea','form','button','a']);
const identifier=/^[A-Za-z_$][\w$]*$/;

/**
 * Analyze with the APPLICATION's Angular compiler and TypeScript, then return staged source replacements.
 * This module deliberately imports neither this package's Angular parser nor its TypeScript AST implementation.
 * It never writes original files, guesses directive selectors, or falls back to a separate template parser.
 */
export async function instrumentProject(configPath:string,options:IntegrationCompilerOptions):Promise<IntegrationPlan>{
  configPath=resolve(configPath);
  const projectRoot=resolve(options.workspaceRoot??dirname(configPath));
  const attribute=options.attribute??'angularMcpSource',eventsAttribute=options.eventsAttribute??'angularMcpEvents';
  const bridgeExport=options.bridgeModuleExport??'AngularMcpBridgeModule';
  if(!identifier.test(attribute)||!identifier.test(eventsAttribute)||!identifier.test(bridgeExport))throw new Error('Bridge attribute and export names must be identifiers');
  const projectRequire=createRequire(configPath);
  let compilerEntry:string;
  try{compilerEntry=projectRequire.resolve('@angular/compiler-cli');}catch{throw new Error(`The project must install its matching @angular/compiler-cli: ${configPath}`);}
  const compilerRequire=createRequire(compilerEntry);
  const typescriptEntry=compilerRequire.resolve('typescript');
  const angularEntry=compilerRequire.resolve('@angular/compiler');
  if(projectRequire.resolve('@angular/compiler')!==angularEntry)throw new Error('The project and compiler-cli resolve different @angular/compiler installations');
  const ngc:any=await import(pathToFileURL(compilerEntry).href);
  const ng:any=await import(pathToFileURL(angularEntry).href);
  const ts:any=compilerRequire('typescript');
  const version=(request:string)=>JSON.parse(readFileSync(compilerRequire.resolve(request+'/package.json'),'utf8')).version as string;
  const angularVersion=version('@angular/compiler'),compilerCliVersion=version('@angular/compiler-cli');
  if(angularVersion!==compilerCliVersion)throw new Error(`Angular compiler ${angularVersion} does not match compiler-cli ${compilerCliVersion}`);
  const diagnostics:IntegrationDiagnostic[]=[];
  const short=(file:string)=>{const path=slash(relative(projectRoot,file));return path.startsWith('../')||isAbsolute(path)?slash(file):path;};
  const within=(file:string)=>{const path=relative(projectRoot,file);return path!==''&&!path.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&!isAbsolute(path);};
  const note=(category:'error'|'warning',code:string,message:string,file?:string,line?:number)=>diagnostics.push({category,code,message,...file?{file:short(file)}:{},...line?{line}:{}});
  const ngDiagnostic=(value:any)=>{
    if(value.category!==ts.DiagnosticCategory.Error&&value.category!==ts.DiagnosticCategory.Warning)return;
    note(value.category===ts.DiagnosticCategory.Error?'error':'warning',String(value.code),ts.flattenDiagnosticMessageText(value.messageText,'\n'),value.file?.fileName,value.file&&value.start!==undefined?value.file.getLineAndCharacterOfPosition(value.start).line+1:undefined);
  };
  const config=ngc.readConfiguration(configPath);config.errors.forEach(ngDiagnostic);
  const compilerOptions={...config.options,noEmit:true,_enableTemplateTypeChecker:true};
  const program=new ngc.NgtscProgram(config.rootNames,compilerOptions,ngc.createCompilerHost({options:compilerOptions}));
  await program.loadNgStructureAsync();
  const ttc=program.compiler.getTemplateTypeChecker();
  ttc.generateAllTypeCheckBlocks();
  for(const value of [...program.getTsSyntacticDiagnostics(),...program.getNgStructuralDiagnostics(),...program.getNgSemanticDiagnostics()])ngDiagnostic(value);
  const checker=()=>program.compiler.getCurrentProgram?.().getTypeChecker()??program.getTsProgram().getTypeChecker();
  const typeOf=(symbol:any):string|undefined=>{
    if(!symbol)return;
    try{const type=typeof ttc.getTypeOfSymbol==='function'?ttc.getTypeOfSymbol(symbol):symbol.tsType;return type?checker().typeToString(type):undefined;}catch{return;}
  };
  const symbolName=(symbol:any):string|undefined=>{try{return (typeof ttc.getTsSymbolOfSymbol==='function'?ttc.getTsSymbolOfSymbol(symbol):symbol.tsSymbol)?.name;}catch{return;}};
  const refOf=(reference:any)=>({name:reference?.node?.name?.text??reference?.name??'anonymous',file:reference?.node?.getSourceFile?.().fileName??reference?.filePath??''});
  const propertyMap=(map:any)=>{
    if(!map)return [];
    if(typeof map.toDirectMappedObject==='function')return Object.entries(map.toDirectMappedObject()).map(([classPropertyName,publicName])=>({classPropertyName,publicName:String(publicName)}));
    if(typeof map[Symbol.iterator]==='function')return [...map].map((entry:any)=>({classPropertyName:entry.classPropertyName??entry[0],publicName:entry.bindingPropertyName??entry[1]}));
    return [];
  };
  const directive=(meta:any):IntegrationDirective=>{const ref=refOf(meta.ref);return {name:ref.name,file:short(ref.file),selector:meta.selector??null,isComponent:!!meta.isComponent,inputs:propertyMap(meta.inputs),outputs:propertyMap(meta.outputs)};};
  // Angular 16–20.1 expose matched directives on the real element/template symbol;
  // newer compilers additionally expose getDirectivesOfNode. Both paths use ngtsc resolution.
  const directivesOf=(component:any,node:any):any[]=>{
    if(typeof ttc.getDirectivesOfNode==='function')return ttc.getDirectivesOfNode(component,node)??[];
    const symbol=ttc.getSymbolOfNode(node,component);
    return (symbol?.directives??[]).map((resolved:any)=>{
      const declaration=resolved.ref?.node;
      return declaration?ttc.getDirectiveMetadata(declaration)??resolved:resolved;
    });
  };

  const describeBinding=(bound:any,cls:any):IntegrationBinding=>{
    let symbol:any;try{symbol=ttc.getSymbolOfNode(bound,cls);}catch{}
    const consumers:IntegrationBinding['consumers']=[];
    for(const binding of symbol?.bindings??[]){
      const target=binding.target,ref=target?.ref&&refOf(target.ref),type=typeOf(binding),member=symbolName(binding);
      if(ref)consumers.push({kind:'directive',name:ref.name,file:short(ref.file),...member?{member}:{},...type?{type}:{}});
      else if(target?.templateNode)consumers.push({kind:'native',name:target.templateNode.name??'template',...member?{member}:{},...type?{type}:{}});
    }
    if(!consumers.length&&symbol?.host?.templateNode)consumers.push({kind:'native',name:symbol.host.templateNode.name??'template'});
    let expressionSymbol:any;const expression=bound.handler??bound.value;
    if(expression&&typeof expression==='object')try{expressionSymbol=ttc.getSymbolOfNode(expression.ast??expression,cls);}catch{}
    const type=typeOf(symbol),expressionType=typeOf(expressionSymbol);
    const twoWay=bound.type===(ng.ParsedEventType?.TwoWay??2)||/^\s*\[\(/.test(bound.sourceSpan?.toString?.()??'');
    return {name:bound.name,expression:typeof expression==='string'?expression:expression?.source??'',resolved:!!symbol,consumers,...type?{type}:{},...expressionType?{expressionType}:{},...bound.handler?{target:bound.target??null,phase:bound.phase??null,twoWay}:{}};
  };
  const originals=new Map<string,string>();
  const text=(file:string)=>{let value=originals.get(file);if(value===undefined){value=readFileSync(file,'utf8');originals.set(file,value);}return value;};
  const replacements=new Map<string,{at:number;content:string}[]>();
  const scopes=new Map<string,Map<number,{decoratorIndex:number;kind:'Component'|'NgModule'}>>();
  type EvaluatedTemplate={decoratorIndex:number;content:string;expression:{start:number;end:number;line:number;column:number};edits:{at:number;content:string}[]};
  const evaluatedTemplates=new Map<string,Map<number,EvaluatedTemplate>>();
  const sourceFiles=program.getTsProgram().getSourceFiles().filter((source:any)=>!source.isDeclarationFile&&!source.fileName.includes('/node_modules/')&&within(source.fileName));
  const sourceByPath=new Map<string,any>(sourceFiles.map((source:any)=>[resolve(source.fileName),source]));
  const nodesById=new Map<string,IntegrationNode>();
  const mergeUnique=<T>(list:T[],add:T[],key:(value:T)=>string)=>{for(const value of add)if(!list.some(existing=>key(existing)===key(value)))list.push(value);};
  const fileOf=(span:any,componentFile:string)=>{const url=span?.start?.file?.url;if(!url)return componentFile;if(url.startsWith('file:'))return fileURLToPath(url);return isAbsolute(url)?resolve(url):resolve(dirname(componentFile),url);};
  const quoteFor=(file:string,at:number):string=>{
    const source=sourceByPath.get(resolve(file));if(!source)return '"';let quote='"';
    const visit=(node:any)=>{if(ts.isStringLiteralLike(node)&&node.getStart(source)<at&&node.end>at)quote=text(file)[node.getStart(source)]==='"'?"'":'"';ts.forEachChild(node,visit);};visit(source);return quote;
  };
  const addScope=(file:string,index:number,decoratorIndex:number,kind:'Component'|'NgModule')=>{let changes=scopes.get(file);if(!changes)scopes.set(file,changes=new Map());changes.set(index,{decoratorIndex,kind});};
  for(const source of sourceFiles){
    let ordinal=-1;
    const visit=(cls:any)=>{
      if(!ts.isClassDeclaration(cls)){ts.forEachChild(cls,visit);return;}
      const index=++ordinal;let meta:any,moduleMeta:any;
      try{meta=ttc.getDirectiveMetadata(cls);moduleMeta=ttc.getNgModuleMetadata(cls);}catch{}
      const decorators=ts.getDecorators(cls)??[];
      const decoratorIndex=(name:string)=>decorators.findIndex((decorator:any)=>{
        if(!ts.isCallExpression(decorator.expression))return false;
        let symbol=program.getTsProgram().getTypeChecker().getSymbolAtLocation(decorator.expression.expression);
        if(symbol?.flags&ts.SymbolFlags.Alias)symbol=program.getTsProgram().getTypeChecker().getAliasedSymbol(symbol);
        return symbol?.name===name&&symbol.declarations?.some((declaration:any)=>slash(declaration.getSourceFile().fileName).includes('/@angular/core/'));
      });
      if(moduleMeta){const at=decoratorIndex('NgModule');if(at>=0)addScope(source.fileName,index,at,'NgModule');}
      if(!meta?.isComponent){ts.forEachChild(cls,visit);return;}
      const component:IntegrationComponent={name:cls.name?.text??'anonymous',file:short(source.fileName),standalone:!!meta.isStandalone};
      const roots=ttc.getTemplate(cls);if(!roots){note('error','missing-template','Angular did not expose this component template',source.fileName);return;}
      let count=0;
      const componentDecoratorIndex=decoratorIndex('Component');
      const componentDecorator=decorators[componentDecoratorIndex];
      const componentMetadata=componentDecorator&&ts.isCallExpression(componentDecorator.expression)&&componentDecorator.expression.arguments[0];
      const templateProperty=componentMetadata&&ts.isObjectLiteralExpression(componentMetadata)&&componentMetadata.properties.find((property:any)=>ts.isPropertyAssignment(property)&&(ts.isIdentifier(property.name)||ts.isStringLiteral(property.name))&&property.name.text==='template');
      // ngtsc uses evaluated-string coordinates for indirect templates, with no authored resource URL.
      // Keep those coordinates and replace this component's template expression, never the shared origin.
      const evaluatedTemplate=(span:any):EvaluatedTemplate|undefined=>{
        if(!templateProperty||!ts.isPropertyAssignment(templateProperty)){note('error','unmapped-evaluated-template','Angular exposed an evaluated template without an authored template expression',source.fileName);return;}
        const content=span?.start?.file?.content;
        if(typeof content!=='string'){note('error','missing-evaluated-template','Angular exposed no evaluated template content',source.fileName);return;}
        let templates=evaluatedTemplates.get(source.fileName);if(!templates)evaluatedTemplates.set(source.fileName,templates=new Map());
        let existing=templates.get(index);
        if(existing){if(existing.content!==content){note('error','inconsistent-evaluated-template','Angular exposed inconsistent evaluated template content for one component',source.fileName);return;}return existing;}
        const initializer=templateProperty.initializer,start=initializer.getStart(source),position=source.getLineAndCharacterOfPosition(start);
        existing={decoratorIndex:componentDecoratorIndex,content,expression:{start,end:initializer.end,line:position.line+1,column:position.character+1},edits:[]};templates.set(index,existing);return existing;
      };
      const walk=(node:any,formId:string|undefined,viewPath:IntegrationNode['viewPath'],repeated:boolean)=>{
        const isElement=node instanceof ng.TmplAstElement;
        const isTemplate=node instanceof ng.TmplAstTemplate;
        const isLoop=!!ng.TmplAstForLoopBlock&&node instanceof ng.TmplAstForLoopBlock;
        let currentView=viewPath,currentRepeated=repeated;
        if(isTemplate||isLoop){const file=fileOf(node.sourceSpan,source.fileName);currentView=[...viewPath,{kind:isLoop?'for':'template',file:short(file),start:node.sourceSpan?.start.offset??0,...!node.sourceSpan?.start?.file?.url?{mapping:'evaluated-template',templateExpressionStart:templateProperty?.initializer.getStart(source)}:{}}];currentRepeated||=isLoop||((directivesOf(cls,node)).some((directive:any)=>{const ref=refOf(directive.ref);return /[/\\]@angular[/\\]common[/\\]/.test(ref.file)&&['NgForOf','NgFor'].includes(ref.name);}));}
        let nextForm=formId;
        if(isElement){
          const resolved=(directivesOf(cls,node)).map(directive);
          const formsHost=resolved.some((directive:IntegrationDirective)=>directive.file.includes('/@angular/forms/')&&['NgModel','FormControlName','FormControlDirective','FormField'].includes(directive.name));
          const outputs=node.outputs.map((bound:any)=>describeBinding(bound,cls));
          const authoredOutputs:IntegrationBinding[]=outputs.filter((output:IntegrationBinding)=>!output.twoWay);
          if(nativeTags.has(node.name)||formsHost||authoredOutputs.length){
            const span=node.startSourceSpan,file=fileOf(span,source.fileName);
            if(!within(file)){note('error','external-template-outside-workspace','Template resource lies outside the staged workspace',file);return;}
            const evaluated=!span.start.file.url?evaluatedTemplate(span):undefined;
            if(!span.start.file.url&&!evaluated)return;
            const start=span.start.offset,end=span.end.offset,raw=(evaluated?evaluated.content:text(file)).slice(start,end),closing=/\/?\s*>$/.exec(raw);
            if(!closing){note('error','unmapped-template-span','Angular source span does not end in a literal opening tag',file,span.start.line+1);return;}
            const sourceKey=evaluated?`${short(file)}#template-expression:${evaluated.expression.start}`:short(file);
            const id='ngmcp_'+digest(`${sourceKey}\0${start}\0${node.name}`).slice(0,24);
            const inputs=node.inputs.map((bound:any)=>describeBinding(bound,cls));
            const events=[...new Set<string>(outputs.filter((output:IntegrationBinding)=>!output.twoWay).map((output:IntegrationBinding)=>(output.target?output.target+':':'')+output.name+(output.phase?'.'+output.phase:'')))];
            const context:IntegrationNodeContext={component,resolvedDirectives:resolved,inputs,outputs,...typeOf(ttc.getSymbolOfNode(node,cls))?{elementType:typeOf(ttc.getSymbolOfNode(node,cls))}:{}};
            let entry=nodesById.get(id);
            if(!entry){
              if(node.attributes.some((item:any)=>[attribute,eventsAttribute].includes(item.name))||node.inputs.some((item:any)=>[attribute,eventsAttribute].includes(item.name))){note('error','bridge-attribute-collision',`Template already uses ${attribute} or ${eventsAttribute}`,file,span.start.line+1);return;}
              entry={id,tag:node.name,native:nativeTags.has(node.name),events:[...events],source:{file:short(file),start,end,line:span.start.line+1,column:span.start.col+1,...evaluated?{mapping:'evaluated-template',templateExpression:evaluated.expression,templateSha256:digest(evaluated.content)}:{}},contexts:[context],resolvedDirectives:[...resolved],inputs:[...inputs],outputs:[...outputs],...formId?{formId}:{},repeated:currentRepeated,viewPath:currentView};
              nodesById.set(id,entry);
              const quote=evaluated?'"':quoteFor(file,start),escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll(quote,quote==='"'?'&quot;':'&#39;');
              const content=` ${attribute}=${quote}${id}${quote} ${eventsAttribute}=${quote}${escape(events.join(','))}${quote}`;
              if(evaluated)evaluated.edits.push({at:start+closing.index,content});else{const edits=replacements.get(file)??[];edits.push({at:start+closing.index,content});replacements.set(file,edits);}
            }else{
              entry.contexts.push(context);mergeUnique(entry.resolvedDirectives,resolved,d=>d.file+'#'+d.name);mergeUnique(entry.inputs,inputs,b=>JSON.stringify(b));mergeUnique(entry.outputs,outputs,b=>JSON.stringify(b));mergeUnique(entry.events,events,e=>e);entry.repeated||=currentRepeated;
            }
            for(const output of authoredOutputs){
              if(!output.resolved)note('warning','unresolved-event-symbol',`Angular exposed no binding symbol for ${output.name}; no dispatcher is inferred`,file,span.start.line+1);
              else if(output.consumers.length&&output.consumers.every(consumer=>consumer.kind==='directive')&&!(node.name==='form'&&output.name==='ngSubmit'&&output.consumers.some(consumer=>consumer.file?.includes('/@angular/forms/'))))note('warning','directive-output-dispatch',`${output.name} is a resolved directive output, not a native DOM event; runtime support must be explicit`,file,span.start.line+1);
            }
            count++;
            if(node.name==='form')nextForm=id;
          }
        }
        const next:unknown[]=[...node.children??[],...node.branches??[],...node.cases??[],...node.groups??[]];
        for(const key of ['empty','placeholder','loading','error','mainBlock'])if(node[key]&&typeof node[key]==='object')next.push(node[key]);
        for(const child of next)walk(child,nextForm,currentView,currentRepeated);
      };
      roots.forEach((node:any)=>walk(node,undefined,[],false));
      if(count&&meta.isStandalone){const at=decoratorIndex('Component');if(at<0)note('error','unresolved-component-decorator','Angular component decorator could not be resolved for scope insertion',source.fileName);else addScope(source.fileName,index,at,'Component');}
      ts.forEachChild(cls,visit);
    };
    visit(source);
  }
  const edits:IntegrationEdit[]=[];
  for(const file of new Set([...replacements.keys(),...scopes.keys(),...evaluatedTemplates.keys()])){
    let content=text(file);
    for(const change of (replacements.get(file)??[]).sort((a,b)=>b.at-a.at))content=content.slice(0,change.at)+change.content+content.slice(change.at);
    if(scopes.has(file)||evaluatedTemplates.has(file)){
      const source=ts.createSourceFile(file,content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),changes=scopes.get(file)??new Map(),templates=evaluatedTemplates.get(file)??new Map();
      const moduleSpecifier=typeof options.bridgeModuleSpecifier==='function'?options.bridgeModuleSpecifier(file):options.bridgeModuleSpecifier;
      if(!moduleSpecifier)throw new Error(`No bridge module import for ${file}`);
      let alias='__AngularMcpBridgeModule',suffix=0;
      const used=new Set<string>();const names=(node:any)=>{if(ts.isIdentifier(node))used.add(node.text);ts.forEachChild(node,names);};names(source);while(used.has(alias))alias='__AngularMcpBridgeModule'+(++suffix);
      let ordinal=-1;
      const transformed=ts.transform(source,[(context:any)=>(root:any)=>{
        const visitor=(node:any):any=>{
          if(!ts.isClassDeclaration(node))return ts.visitEachChild(node,visitor,context);
          const currentIndex=++ordinal,scopeChange=changes.get(currentIndex),templateChange=templates.get(currentIndex);
          const change=scopeChange??(templateChange?{decoratorIndex:templateChange.decoratorIndex,kind:'Component'}:undefined);if(!change)return ts.visitEachChild(node,visitor,context);
          const decorators=ts.getDecorators(node)??[],target=decorators[change.decoratorIndex];
          if(!target||!ts.isCallExpression(target.expression)||!ts.isObjectLiteralExpression(target.expression.arguments[0])){note('error','nonliteral-angular-metadata',`${change.kind} metadata must be an authored object literal to add the bridge scope`,file);return node;}
          const call=target.expression,metadata=call.arguments[0];let found=false;
          const properties=metadata.properties.map((property:any)=>{
            const name=property.name&&(ts.isIdentifier(property.name)||ts.isStringLiteral(property.name))?property.name.text:undefined;
            if(name==='template'&&templateChange&&ts.isPropertyAssignment(property)){
              let template=templateChange.content;
              for(const edit of templateChange.edits.slice().sort((a:any,b:any)=>b.at-a.at))template=template.slice(0,edit.at)+edit.content+template.slice(edit.at);
              return ts.factory.updatePropertyAssignment(property,property.name,ts.factory.createStringLiteral(template));
            }
            if(name!=='imports'||!scopeChange)return property;
            if(!ts.isPropertyAssignment(property)){note('error','nonliteral-imports-property','Angular imports must be a property assignment',file);return property;}
            found=true;const prior=property.initializer;
            const values=ts.isArrayLiteralExpression(prior)?[...prior.elements]:[ts.factory.createSpreadElement(prior)];
            return ts.factory.updatePropertyAssignment(property,property.name,ts.factory.createArrayLiteralExpression([...values,ts.factory.createIdentifier(alias)],true));
          });
          if(scopeChange&&!found)properties.push(ts.factory.createPropertyAssignment('imports',ts.factory.createArrayLiteralExpression([ts.factory.createIdentifier(alias)])));
          const replacement=ts.factory.updateDecorator(target,ts.factory.updateCallExpression(call,call.expression,call.typeArguments,[ts.factory.updateObjectLiteralExpression(metadata,properties),...call.arguments.slice(1)]));
          const modifiers=(node.modifiers??[]).map((modifier:any)=>modifier===target?replacement:modifier);
          return ts.visitEachChild(ts.factory.updateClassDeclaration(node,modifiers,node.name,node.typeParameters,node.heritageClauses,node.members),visitor,context);
        };return ts.visitNode(root,visitor);
      }]);
      const imported=ts.factory.createImportDeclaration(undefined,ts.factory.createImportClause(false,undefined,ts.factory.createNamedImports([ts.factory.createImportSpecifier(false,ts.factory.createIdentifier(bridgeExport),ts.factory.createIdentifier(alias))])),ts.factory.createStringLiteral(moduleSpecifier));
      const output=ts.factory.updateSourceFile(transformed.transformed[0],[...(changes.size?[imported]:[]),...transformed.transformed[0].statements]);
      content=ts.createPrinter({newLine:ts.NewLineKind.LineFeed}).printFile(output);transformed.dispose();
    }
    edits.push({file:short(file),beforeSha256:digest(text(file)),content});
  }
  const plan:IntegrationPlan={formatVersion:1,configPath,projectRoot,valid:!diagnostics.some(d=>d.category==='error'),angularVersion,typescriptVersion:ts.version,compilerCliVersion,toolchain:{compilerCli:compilerEntry,typescript:typescriptEntry,angularCompiler:angularEntry},nodes:[...nodesById.values()].sort((a,b)=>a.id.localeCompare(b.id)),edits:edits.sort((a,b)=>a.file.localeCompare(b.file)),diagnostics};
  return plan;
}

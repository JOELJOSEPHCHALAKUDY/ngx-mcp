import type {IntegrationDescriptor} from './integration-runtime.js';

export interface IntegrationFormTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {readOnlyHint: boolean; destructiveHint: boolean};
  _meta: {angularMcpTarget: {sourceId: string; instanceId: string}};
  node: IntegrationDescriptor;
  bindings: Record<string, IntegrationDescriptor>;
}

/** Shared catalog policy; the transport supplies the stable, exact-instance tool name. */
export function integrationFormTools(nodes: IntegrationDescriptor[], nameForInstance: (instanceId: string) => string): IntegrationFormTool[] {
  const result: IntegrationFormTool[] = [];
  for (const node of nodes) {
    if (!node.visible || node.disabled || node.kind !== 'form' || node.submitterCount !== undefined && node.submitterCount !== 1) continue;
    const keys = new Set<string>(), bindings = Object.create(null), properties = Object.fromEntries([]);
    let supported = true;
    for (const field of node.fields ?? []) {
      if (!field.visible || field.disabled || field.readonly) continue;
      if (!field.operations.includes('fill') || field.schema === false) { supported = false; break; }
      const key = field.path?.length ? field.path.join('.') : field.instanceId;
      if (keys.has(key)) { supported = false; break; }
      keys.add(key); bindings[key] = field;
      Object.defineProperty(properties, key, {value: {...field.schema, title: field.label || key}, enumerable: true, writable: true, configurable: true});
    }
    if (!supported) continue;
    result.push({name: nameForInstance(node.instanceId), title: node.label.slice(0, 80) || 'Submit live Angular form', description: 'Submit this exact live Angular form through its original UI. Omitted fields retain current values. Angular evaluates dynamic and cross-field validation at runtime. Business success requires observing the app outcome.', inputSchema: {type: 'object', properties, additionalProperties: false}, annotations: {readOnlyHint: false, destructiveHint: true}, _meta: {angularMcpTarget: {sourceId: node.sourceId, instanceId: node.instanceId}}, node, bindings});
  }
  return result;
}

export interface IntegrationNodeQuery {kind?: IntegrationDescriptor['kind'];visible?:boolean;operation?:IntegrationDescriptor['operations'][number];limit?:number;offset?:number;includeFields?:boolean}
/** Bound discovery responses independently from the full internal form catalog. Restart pagination after a UI mutation. */
export function integrationListNodes(nodes: IntegrationDescriptor[], query: IntegrationNodeQuery = {}) {
  const limit=query.limit??100,offset=query.offset??0;
  if(!Number.isInteger(limit)||limit<1||limit>500||!Number.isInteger(offset)||offset<0||offset>100000)throw new Error('Invalid node discovery page bounds');
  const matches=nodes.filter(node=>(query.kind===undefined||node.kind===query.kind)&&(query.visible===undefined||node.visible===query.visible)&&(query.operation===undefined||node.operations.includes(query.operation)));
  const selected=matches.slice(offset,offset+limit).map(node=>{if(query.includeFields!==false)return node;const compact={...node};delete compact.fields;compact.validation={status:node.validation.status,fields:[],groups:[]};return compact;});
  return {nodes:selected,total:matches.length,offset,nextOffset:offset+selected.length<matches.length?offset+selected.length:null};
}

/** Validate the JSON Schema subset emitted by our browser tools; unsupported rules fail closed. */
export function integrationValidateInput(schema: any, value: any): void {
  const json = [value], seen = new Set<object>(); let count = 0, characters = 0;
  while (json.length) {
    const current = json.pop();
    if (++count > 10000) throw new Error('Tool input exceeds the JSON node budget');
    if (current === null || typeof current === 'boolean') continue;
    if (typeof current === 'number') { if (!Number.isFinite(current)) throw new Error('Tool input must contain finite JSON numbers'); continue; }
    if (typeof current === 'string') { characters += current.length; if (characters > 1048576) throw new Error('Tool input exceeds the JSON string budget'); continue; }
    if (typeof current !== 'object') throw new Error('Tool input must contain JSON data only');
    if (seen.has(current)) throw new Error('Tool input contains repeated or cyclic object references'); seen.add(current);
    const array = Array.isArray(current), prototype = Object.getPrototypeOf(current);
    if (!array && prototype !== Object.prototype && prototype !== null) throw new Error('Tool input must contain plain JSON objects');
    const descriptors = Object.getOwnPropertyDescriptors(current);
    for (const key of Reflect.ownKeys(current)) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string') throw new Error('Tool input contains a non-JSON property');
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= current.length)) throw new Error('Tool input arrays cannot contain extra properties');
      const property = descriptors[key];
      if (!property || !('value' in property) || !property.enumerable) throw new Error('Tool input cannot contain accessors or hidden properties');
      characters += key.length; if (characters > 1048576) throw new Error('Tool input exceeds the JSON string budget');
      json.push(property.value);
    }
    if (array && Object.keys(current).length !== current.length) throw new Error('Tool input arrays cannot be sparse');
  }
  const schemas = [schema]; let schemaCount = 0;
  while (schemas.length) {
    const current = schemas.pop();
    if (++schemaCount > 1000) throw new Error('Tool schema exceeds the validation budget');
    if (typeof current === 'boolean') continue;
    if (!current || typeof current !== 'object' || Array.isArray(current)) throw new Error('Invalid tool input schema');
    for (const key of Object.keys(current)) {
      if (!['type','properties','required','additionalProperties','items','anyOf','enum','const','minimum','maximum','exclusiveMinimum','exclusiveMaximum','minItems','maxItems','minLength','maxLength','title','description','default','examples','readOnly','writeOnly','deprecated','$schema','$id'].includes(key)) throw new Error('Unsupported browser input schema keyword: ' + key);
    }
    if (current.type !== undefined) {
      const types = Array.isArray(current.type) ? current.type : [current.type];
      if (!types.length) throw new Error('Invalid tool schema type');
      for (const type of types) if (!['object','array','string','number','integer','boolean','null'].includes(type)) throw new Error('Unsupported browser input schema type');
    }
    if (current.required !== undefined) { if (!Array.isArray(current.required)) throw new Error('Invalid required schema'); for (const key of current.required) if (typeof key !== 'string') throw new Error('Invalid required property'); }
    if (current.properties !== undefined) { if (!current.properties || typeof current.properties !== 'object' || Array.isArray(current.properties)) throw new Error('Invalid properties schema'); for (const key of Object.keys(current.properties)) schemas.push(current.properties[key]); }
    if (current.additionalProperties !== undefined) schemas.push(current.additionalProperties);
    if (current.items !== undefined) schemas.push(current.items);
    if (current.anyOf !== undefined) { if (!Array.isArray(current.anyOf) || !current.anyOf.length) throw new Error('Invalid anyOf schema'); for (const branch of current.anyOf) schemas.push(branch); }
    if (current.enum !== undefined) { if (!Array.isArray(current.enum) || !current.enum.length) throw new Error('Invalid enum schema'); for (const item of current.enum) if (item !== null && !['string','number','boolean'].includes(typeof item)) throw new Error('Browser input enum supports JSON primitives only'); }
    if (Object.hasOwn(current, 'const') && current.const !== null && !['string','number','boolean'].includes(typeof current.const)) throw new Error('Browser input const supports JSON primitives only');
    for (const key of ['minimum','maximum','exclusiveMinimum','exclusiveMaximum']) if (current[key] !== undefined && (typeof current[key] !== 'number' || !Number.isFinite(current[key]))) throw new Error('Invalid numeric schema bound');
    for (const key of ['minItems','maxItems','minLength','maxLength']) if (current[key] !== undefined && (!Number.isSafeInteger(current[key]) || current[key] < 0)) throw new Error('Invalid size schema bound');
  }
  const pending = [{schema, value}];
  while (pending.length) {
    const entry = pending.pop(); if (!entry) break;
    const rule = entry.schema, data = entry.value;
    if (rule === true) continue; if (rule === false) throw new Error('Tool input does not match its schema');
    if (rule.type !== undefined) {
      let matches = false;
      const types = Array.isArray(rule.type) ? rule.type : [rule.type];
      for (const type of types) {
        if (type === 'null' ? data === null : type === 'array' ? Array.isArray(data) : type === 'object' ? data !== null && typeof data === 'object' && !Array.isArray(data) : type === 'integer' ? typeof data === 'number' && Number.isInteger(data) : typeof data === type) matches = true;
      }
      if (!matches) throw new Error('Tool input has an invalid type');
    }
    if (rule.enum !== undefined) { let matches = false; for (const item of rule.enum) if (item === data) matches = true; if (!matches) throw new Error('Tool input is not an allowed option'); }
    if (Object.hasOwn(rule, 'const') && data !== rule.const) throw new Error('Tool input does not match its constant');
    if (rule.anyOf !== undefined) { let matches = false; for (const branch of rule.anyOf) { try { integrationValidateInput(branch, data); matches = true; break; } catch { /* Try the next declared branch. */ } } if (!matches) throw new Error('Tool input does not match any allowed schema'); }
    if (typeof data === 'number' && (rule.minimum !== undefined && data < rule.minimum || rule.maximum !== undefined && data > rule.maximum || rule.exclusiveMinimum !== undefined && data <= rule.exclusiveMinimum || rule.exclusiveMaximum !== undefined && data >= rule.exclusiveMaximum)) throw new Error('Tool input is outside its numeric bounds');
    if (typeof data === 'string') { const size = Array.from(data).length; if (rule.minLength !== undefined && size < rule.minLength || rule.maxLength !== undefined && size > rule.maxLength) throw new Error('Tool input is outside its string bounds'); }
    if (Array.isArray(data)) {
      if (rule.minItems !== undefined && data.length < rule.minItems || rule.maxItems !== undefined && data.length > rule.maxItems) throw new Error('Tool input is outside its array bounds');
      if (rule.items !== undefined) for (const item of data) pending.push({schema: rule.items, value: item});
    } else if (data !== null && typeof data === 'object') {
      for (const key of rule.required ?? []) if (!Object.hasOwn(data, key)) throw new Error('Missing required tool input: ' + key);
      for (const key of Object.keys(data)) {
        if (rule.properties && Object.hasOwn(rule.properties, key)) pending.push({schema: rule.properties[key], value: data[key]});
        else if (rule.additionalProperties === false) throw new Error('Unexpected tool input: ' + key);
        else if (rule.additionalProperties && typeof rule.additionalProperties === 'object') pending.push({schema: rule.additionalProperties, value: data[key]});
      }
    }
  }
}

/** Embed the exact shared implementation; contextual argument types keep generated TS strict-safe. */
export function integrationToolCatalogSource(): string {
  return 'const integrationListNodes: (nodes: any[], query?: any) => any = ' + integrationListNodes.toString() + ';\n' +
    'const integrationFormTools: (nodes: any[], nameForInstance: (instanceId: string) => string) => any[] = ' + integrationFormTools.toString() + ';\n' +
    'const integrationValidateInput: (schema: any, value: any) => void = ' + integrationValidateInput.toString() + ';\n';
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { Ajv } from 'ajv';
import { compile } from '../src/compiler.js';
import { baseline } from '../src/baseline.js';
import { Project } from '../src/project.js';
import { SchemaCompiler } from '../src/schema.js';
import { reviewedTools } from '../src/approval.js';
import { applyProbes, exampleFor, type ProbeReport } from '../src/probe.js';

const config = 'fixtures/orders/tsconfig.json';
const manifest = compile(config, 'routes.ts#routes');
const project = new Project(config);
const orders = project.classes.find(c => c.name?.text === 'OrdersService')!;
const selected = orders.members.find(m => ts.isMethodDeclaration(m) && m.name.getText() === 'getUserOrders') as ts.MethodDeclaration;
const schema = new SchemaCompiler(project.checker).method(selected);
const ajv = new Ajv({ strict: false });
const validate = ajv.compile(schema.inputSchema);

test('baseline reproduces protected-method exposure and broken arrays/unions', () => {
  const naive = baseline(config);
  assert(naive.some(c => c.id === 'OrdersService.rebuildIndex'));
  const accepts = ajv.compile(naive.find(c => c.id === 'OrdersService.getUserOrders')!.inputSchema);
  assert(accepts({}));
  assert(!accepts({ tags: ['open'], key: 123 }));
});
test('type-aware extraction preserves required inputs and rejects extra arguments', () => {
  assert(!validate({}));
  assert(!validate({ tags: ['open'], key: 123, surprise: true }));
  assert.deepEqual(schema.issues, []);
});
test('arrays, unions and default parameters validate correctly', () => {
  assert(validate({ tags: ['open'], key: 123 }));
  assert(validate({ tags: [], key: 'user', limit: 5 }));
  assert(!validate({ tags: 'open', key: 123 }));
  assert(!validate({ tags: [], key: false }));
});
test('Promise output resolves to an array of nested order objects', () => {
  const output = ajv.compile(schema.outputSchema);
  assert(output([{ id: 'a', total: 5, status: 'open' }]));
  assert(!output([{ id: 'a', total: '5', status: 'open' }]));
  assert(!output([{ id: 'a', total: 5, status: 'not-a-status' }]));
});
test('unknown types fail closed instead of becoming permissive objects', () => {
  const unknown = orders.members.find(m => ts.isMethodDeclaration(m) && m.name.getText() === 'unknown') as ts.MethodDeclaration;
  const result = new SchemaCompiler(project.checker).method(unknown);
  assert(result.issues.length > 0);
  assert.equal(result.outputSchema, false);
});
test('trace follows a private component helper to the injected service', () => {
  const capability = manifest.capabilities.find(c => c.route === '/orders' && c.handler === 'refresh')!;
  assert.deepEqual(capability.callPath, ['OrdersPage.refresh','OrdersPage.reload','OrdersService.listOrders']);
});
test('a local object with the same method name is excluded', () => {
  assert(!manifest.capabilities.some(c => c.component === 'PreviewPage'));
});
test('service scanning does not leak protected/private/unreferenced methods into capabilities', () => {
  assert(!manifest.capabilities.some(c => c.bindings.some(b => ['secret','rebuildIndex','unknown'].includes(b.method))));
});
test('confirmation is retained as workflow evidence at the component handler', () => {
  const capability = manifest.capabilities.find(c => c.route === '/orders' && c.handler === 'requestDelete')!;
  assert.equal(capability.workflow.confirmation,'observed');
  assert.equal(capability.handler,'requestDelete');
  assert(capability.bindings.some(b => b.method === 'deleteOrder'));
});
test('constructor injection, lazy route arrays and lazy components resolve', () => {
  assert(manifest.capabilities.some(c => c.route === '/constructor'));
  assert(manifest.capabilities.some(c => c.route === '/lazy/list'));
  assert(manifest.capabilities.some(c => c.route === '/lazy-component'));
});
test('static useClass override is resolved and dynamic factories are blocked', () => {
  assert.equal(manifest.capabilities.find(c => c.route === '/override' && c.handler === 'refresh')?.bindings[0].service,'PreviewOrdersService');
  assert(manifest.capabilities.filter(c => c.route === '/factory').every(c => c.status === 'blocked'));
});
test('default exposure is empty; only fingerprint-matching explicit reviews produce tools', () => {
  assert.deepEqual(reviewedTools(manifest, []), []);
  const c = manifest.capabilities.find(c => c.status === 'candidate')!;
  const approval = { id: c.id, fingerprint: c.fingerprint, description: 'Reviewed fixture action', effect: 'read' as const };
  assert.equal(reviewedTools(manifest, [approval]).length, 1);
  assert.throws(() => reviewedTools(manifest,[{ ...approval, fingerprint: 'stale' }]),/Stale approval/);
});
test('blocked candidates cannot be approved', () => {
  const c = manifest.capabilities.find(c => c.status === 'blocked')!;
  assert.throws(() => reviewedTools(manifest,[{ id:c.id,fingerprint:c.fingerprint,description:'Blocked',effect:'read' }]), /Blocked capability/);
});
test('identical sources produce byte-identical manifests', () => {
  assert.equal(JSON.stringify(manifest), JSON.stringify(compile(config,'routes.ts#routes')));
});
test('aliased lazy loaders and default-export components resolve',()=>{
  assert(manifest.routes.some(r=>r.path==='/aliased-lazy/list'));
  assert(manifest.routes.some(r=>r.path==='/default-export'&&r.component==='SelectorlessPage'));
});
test('selectorless routed components and protected template handlers are supported',()=>{
  const c=manifest.capabilities.find(c=>c.route==='/default-export')!;
  assert.equal(c.componentSelector,'ng-component');assert.equal(c.handler,'load');assert.equal(c.status,'candidate');
});
test('@Service without metadata is traced as an injected service',()=>{
  assert.equal(manifest.capabilities.find(c=>c.route==='/default-export')!.bindings[0].service,'NewService');
});
test('native password and checkbox fields have explicit schemas',()=>{
  const c=manifest.capabilities.find(c=>c.route==='/default-export')!;
  assert(c.fields.every(f=>f.supported));const input=ajv.compile(c.inputSchema);
  assert(input({secret:'synthetic',consent:true}));assert(!input({secret:'synthetic',consent:'true'}));
  assert.equal((c.fields.find(f=>f.name==='secret')!.schema as Record<string,unknown>).writeOnly,true);
});
test('Signal Forms compile external submit and semantic label bindings',()=>{
 const c=manifest.capabilities.find(c=>c.route==='/signal'&&c.action.kind==='form')!;
 assert.equal(c.status,'candidate');assert.equal(c.plan!.mode,'submit');assert.equal(c.plan!.submit!.selector,'button[type="submit"]');
 assert.equal(c.fields.find(f=>f.name==='name')!.label,'Name');assert.deepEqual(c.fields.find(f=>f.name==='category')!.options,[{value:'A',label:'Category A'}]);
});
test('repeated Signal Forms retain row operations and nested validation',()=>{
 const c=manifest.capabilities.find(c=>c.route==='/signal'&&c.action.kind==='form')!;const rows=c.plan!.repeats[0];
 assert.equal(rows.name,'lessons');assert.equal(rows.rowSelector,'div.lesson');assert(rows.add.selector.includes('.add-row'));assert.equal(rows.remove!.selector,'button.remove');
 const input=ajv.compile(c.inputSchema);assert(input({name:'Valid course',category:'A',lessons:[{name:'First lesson',url:'example'}]}));
 assert(!input({name:'bad',category:'A',lessons:[{name:'First lesson',url:'example'}]}));
 assert(!input({name:'Valid course',category:'A',lessons:[]}));
 assert(!input({name:'Valid course',category:'A',lessons:[{name:'x',url:'example'}]}));
});
test('draft capabilities are derived from actual global storage subscriptions',()=>{
 const c=manifest.capabilities.find(c=>c.route==='/draft')!;assert.equal(c.action.kind,'workflow');assert.equal(c.plan!.mode,'edit');assert.equal(c.plan!.effect!.key,'example-draft');
 assert(c.plan!.effect!.source.line>0);assert.equal(c.bindings.length,0);assert(c.callPath.includes('localStorage.setItem'));
 const input=ajv.compile(c.inputSchema);assert(!input({}));assert(input({title:'Draft title'}));
});
test('a shadowed storage object is not claimed as a persisted draft',()=>{
 assert(!manifest.capabilities.some(c=>c.route==='/shadow-storage'));
});

// ---- Contract fidelity, targeting, forwarded events, shells, page-load and widget actions ----
const features = compile('fixtures/features/tsconfig.json', 'routes.ts#routes');
const feature = (route: string, handler: string) => features.capabilities.find(c => c.route === route && c.handler === handler);
const props = (c: { inputSchema: unknown } | undefined) => (c!.inputSchema as { properties: Record<string, Record<string, unknown>>; required: string[] });

test('reactive validators become schema constraints, including conditional ones per route', () => {
  const add = props(feature('/users/new', 'save'));
  assert.deepEqual(add.required, ['email', 'password']);
  assert.equal(add.properties.password.minLength, 6);
  assert.match(String(add.properties.email.pattern), /@/);
  const edit = props(feature('/users/:id', 'save'));
  assert.deepEqual(edit.required, ['id', 'email']);
  assert.equal(edit.properties.id.minLength, 1);
  assert.equal(new Ajv({ strict: false }).compile(edit.properties.id as object)('..'), false); // no route traversal
  const ok = new Ajv({ strict: false }).compile(edit as object);
  assert(ok({ id: '1', email: 'a@example.test', password: '' }));
  assert(!ok({ id: '1', email: 'not-an-email' }));
  assert(!ok({ id: '1', email: 'a@example.test', password: 'abc' }));
});
test('a row action inside a loop is selected by the item it acts on', () => {
  const del = feature('/users', 'deleteUser')!;
  assert.equal(del.status, 'candidate');
  assert.deepEqual(del.target, { param: 'id', source: 'context', path: ['id'],inputSchema:{type:'string'} });
  assert.deepEqual(props(del).required, ['id']);
});
test('a forwarded child output belongs to the parent handler and targets the emitting row', () => {
  const remove = feature('/items', 'removeItem')!;
  assert.equal(remove.status, 'candidate');
  assert.equal(remove.component, 'ItemsPage');
  assert(remove.action.selector.includes('item-list') && remove.action.selector.includes('.x'));
  assert.deepEqual(remove.target, { param: 'id', source: 'context', path: ['id'] });
});
test('the bootstrapped shell contributes root-scoped actions', () => {
  const logout = feature('/', 'logout')!;
  assert.equal(logout.status, 'candidate');
  assert.equal(logout.component, 'AppRoot');
  assert.equal(logout.global, true); // present on every route, so no route is required
});
test('a page-load action that reads a signed link is a navigation capability', () => {
  const verify = feature('/verify', 'ngOnInit')!;
  assert.equal(verify.action.kind, 'navigation');
  assert.deepEqual(verify.queryParams, ['token']);
  assert.deepEqual(props(verify).required, ['token']);
});
test('a Material paginator becomes a driven page/pageSize capability', () => {
  const pager = feature('/pager', 'onPage')!;
  assert.deepEqual(pager.drive?.paginator?.sizes, [5, 10]);
  assert.deepEqual(props(pager).properties.pageSize, { type: 'integer', enum: [5, 10] });
  assert.deepEqual(props(pager).required, ['page', 'pageSize']);
});
test('an action inside a Material menu is revealed through its trigger', () => {
  const lang = feature('/lang', 'setLang')!;
  assert.equal(lang.status, 'candidate');
  assert.equal(lang.reveal?.trigger, 'lang-menu button.trigger[aria-haspopup="menu"]');
  assert(lang.action.selector.startsWith('.mat-mdc-menu-panel '));
  assert.deepEqual(lang.target, { param: 'value', source: 'context', path: ['value'],inputSchema:{type:'string'},projected:{owner:'lang-menu',collection:['langs'],labelPath:['name']} });
});
test('a manifest whose content no longer matches its fingerprint cannot serve approvals', () => {
  const c = features.capabilities.find(x => x.status === 'candidate' && x.route === '/users')!;
  const approval = { id: c.id, fingerprint: c.fingerprint, description: 'delete a user', effect: 'write' as const };
  assert.equal(reviewedTools(features, [approval]).length, 1);
  const tampered = { ...features, capabilities: features.capabilities.map(x => x.id === c.id ? { ...x, inputSchema: { type: 'object', properties: {}, additionalProperties: true } } : x) };
  assert.throws(() => reviewedTools(tampered, [approval]), /does not match its fingerprint/);
});
test('a mutating operation cannot be approved as read-only', () => {
  const c = features.capabilities.find(x => x.status === 'candidate' && x.route === '/users')!;
  assert.throws(() => reviewedTools(features, [{ id: c.id, fingerprint: c.fingerprint, description: 'x', effect: 'read' }]), /not demonstrably read-only/);
});
test('an unknown conditional validator never claims required', () => {
  const m = compile('fixtures/features/tsconfig.json', 'routes.ts#routes');
  // `...(!this.id ? [Validators.required] : [])` is folded only because `id` comes from the route params.
  const add = m.capabilities.find(x => x.route === '/users/new' && x.handler === 'save')!;
  assert.deepEqual((add.inputSchema as { required: string[] }).required, ['email', 'password']);
});
test('a template-driven form feeds a button handler; a handler that replaces the model has no inputs', () => {
  const search = feature('/search', 'search')!;
  assert.deepEqual(Object.keys(props(search).properties), ['q']);
  const clear = feature('/search', 'clear')!;
  assert.deepEqual(Object.keys(props(clear).properties), []);
  assert.equal(search.plan?.submit?.label, 'Search');
  assert.equal(clear.plan?.submit?.label, 'Clear');
});
test('`*ngIf="x as y"` is not a loop, so its button needs no row target', () => {
  const go = feature('/search', 'go')!;
  assert.equal(go.status, 'candidate');
  assert.equal(go.target, undefined);
});
test('looped options over a literal component array become a static enum named after the sent key', () => {
  const theme = feature('/search', 'onTheme')!;
  assert.deepEqual(props(theme).properties.theme, { type: 'string', enum: ['light', 'dark'] });
  assert.equal(theme.fields[0].dynamicOptions, undefined);
});
test('a text input handler (with $any in its call) becomes a single-value capability', () => {
  const filter = feature('/search', 'onFilter')!;
  assert.equal(filter.status, 'candidate');
  assert.deepEqual(Object.keys(props(filter).properties), ['q']); // named after the key it is sent under
  assert.equal(filter.plan?.mode, 'edit');
});
test('a dialog form is exposed through the trigger that opens it; a bare confirm dialog never is', () => {
  const dialogs = features.capabilities.filter(c => c.route === '/stock' && c.component === 'StockDialog');
  assert.equal(dialogs.length, 2); // one per opener: Add and Edit
  assert(dialogs.every(d => d.reveal?.kind === 'dialog' && d.reveal.panel === 'mat-dialog-container'));
  const edit = dialogs.find(d => d.reveal?.target)!;
  assert.deepEqual(edit.reveal!.target, { param: 'id', source: 'context', path: ['id'] });
  assert.deepEqual(props(edit).required.sort(), ['id', 'name'].sort());
  const add = dialogs.find(d => !d.reveal?.target)!;
  assert.deepEqual(props(add).required, ['name']);
  assert.equal(features.capabilities.some(c => c.component === 'ConfirmBox'), false, 'a person confirms; the tool never does');
  assert(features.capabilities.some(c => c.component === 'StockPage' && c.handler === 'askDelete' && c.status === 'candidate'));
});
test('route paths built from constants, `as const` objects, enums and templates are resolved', () => {
  const paths = features.routes.map(r => r.path);
  assert(paths.includes('/users-const'));
  assert(paths.includes('/pager-tpl'));
});
test('read approval needs demonstrably read-only traced calls; dispatches, ui-state and storage writes need write', () => {
  const ui = features.capabilities.find(x => x.effectKind === 'ui-state' && x.status === 'candidate')!;
  assert.throws(() => reviewedTools(features, [{ id: ui.id, fingerprint: ui.fingerprint, description: 'x', effect: 'read' }]), /not demonstrably read-only/);
  const stateful = { ...features, capabilities: features.capabilities.map(x => x === ui ? { ...x, effectKind: undefined, bindings: [{ ...x.bindings[0], token: 'Store', service: 'Store', method: 'dispatch' }] } : x) };
  assert.throws(() => reviewedTools(stateful as typeof features, [{ id: ui.id, fingerprint: ui.fingerprint, description: 'x', effect: 'read' }]), /Manifest content|not demonstrably/);
});
test('an authored confirmation business action requires exact host confirmation', () => {
  const action=features.capabilities.find(c=>c.component==='ConfirmDelete');assert(action);
  assert.equal(action.workflow.requiresConfirmation,true);
  assert.deepEqual((action.contextSchema as {properties:unknown}).properties,{confirmedCapability:{const:action.id}});
  assert(features.capabilities.some(c => c.component === 'ProjectPage' && c.handler === 'dropProject')); // the opener is the operation; a person confirms
});
test('a row id never shares its name with the route parameter', () => {
  const remove = feature('/projects/:id', 'remove')!;
  assert.equal(remove.target?.param, 'taskId');
  assert.deepEqual(props(remove).required.sort(), ['id', 'taskId']);
});
test('probe results are merged with new fingerprints, learned constraints and observed evidence; observation trumps a read approval', () => {
  const c = features.capabilities.find(x => x.route === '/users/new' && x.handler === 'save')!;
  const report: ProbeReport = { id: c.id, effectClass: 'write', effects: { http: [{ method: 'POST', path: '/api/users', bodyKeys: ['email'] }], storage: [], navigated: false, overlay: false, domChanged: false, dialogs: [], calls: [] },
    confirmationRequired: false, probes: [], agreement: 0.9, learned: { password: { minLength: 8, maxLength: 64 } }, disagreements: [] };
  const merged = applyProbes(features, [report]);
  const next = merged.capabilities.find(x => x.id === c.id)!;
  assert.equal((next.inputSchema as { properties: Record<string, { minLength: number }> }).properties.password.minLength, 8);
  assert.equal(next.observed?.effectClass, 'write');
  assert.notEqual(next.fingerprint, c.fingerprint);
  assert.equal(reviewedTools(merged, [{ id: c.id, fingerprint: next.fingerprint, description: 'x', effect: 'write' }]).length, 1); // fingerprint still verifies
  assert.throws(() => reviewedTools(merged, [{ id: c.id, fingerprint: next.fingerprint, description: 'x', effect: 'read' }]), /not demonstrably read-only|change state/);
  assert.deepEqual(exampleFor({ type: 'object', properties: { n: { type: 'integer', minimum: 3 }, s: { type: 'string', minLength: 5 } } }), { n: 3, s: 'aaaaa' });
});

#!/usr/bin/env node
// Seeded generator of Angular standalone components/services with a known truth file.
// Usage: node generate.mjs <outDir> <seed> <count>
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve(process.argv[2] || './out');
const seed = parseInt(process.argv[3] || '1', 10);
const count = parseInt(process.argv[4] || '40', 10);

// ---------- PRNG ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(seed * 2654435761);
const r = {
  f: () => rnd(),
  int: (a, b) => a + Math.floor(rnd() * (b - a + 1)),
  pick: (arr) => arr[Math.floor(rnd() * arr.length)],
  chance: (p) => rnd() < p,
  shuffle: (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; },
};

// ---------- string utils ----------
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').toLowerCase();
const human = (s) => cap(s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase());
const sq = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const arrLit = (a) => '[' + a.map((x) => (typeof x === 'string' ? sq(x) : String(x))).join(', ') + ']';
const ind = (s, n = 2) => s.split('\n').map((l) => (l ? ' '.repeat(n) + l : l)).join('\n');

// ---------- vocabulary ----------
const ENTS = [
  { Ent: 'Invoice', s: 'invoice', p: 'invoices', text: ['customerName', 'billingName', 'payee'], email: ['billingEmail', 'contactEmail'], num: [['amount', 1, 50000], ['discountPercent', 0, 100], ['quantity', 1, 500]], code: ['invoiceNumber', 'poReference'], notes: ['memo', 'notes'], enums: { status: ['draft', 'sent', 'paid', 'overdue'], currency: ['USD', 'EUR', 'GBP', 'AED'] } },
  { Ent: 'Ticket', s: 'ticket', p: 'tickets', text: ['subject', 'summary', 'reporterName'], email: ['reporterEmail', 'requesterEmail'], num: [['priority', 1, 5], ['estimateHours', 1, 80], ['severity', 1, 4]], code: ['ticketCode', 'referenceId'], notes: ['description', 'details'], enums: { category: ['bug', 'billing', 'feature', 'question'], queue: ['tier1', 'tier2', 'security'] } },
  { Ent: 'Device', s: 'device', p: 'devices', text: ['deviceName', 'label', 'ownerName'], email: ['ownerEmail', 'adminEmail'], num: [['batteryThreshold', 5, 95], ['reportingInterval', 1, 60], ['slotCount', 1, 16]], code: ['serialNumber', 'assetTag'], notes: ['remarks', 'notes'], enums: { firmware: ['stable', 'beta', 'legacy'], zone: ['north', 'south', 'east', 'west'] } },
  { Ent: 'Recipe', s: 'recipe', p: 'recipes', text: ['recipeTitle', 'dishName', 'authorName'], email: ['authorEmail', 'submitterEmail'], num: [['servings', 1, 24], ['cookMinutes', 5, 480], ['calories', 50, 2500]], code: ['recipeCode', 'slug'], notes: ['instructions', 'tips'], enums: { cuisine: ['italian', 'thai', 'mexican', 'indian'], difficulty: ['easy', 'medium', 'hard'] } },
  { Ent: 'Shipment', s: 'shipment', p: 'shipments', text: ['recipient', 'consigneeName', 'carrierName'], email: ['recipientEmail', 'notifyEmail'], num: [['weightKg', 1, 1000], ['parcelCount', 1, 50], ['declaredValue', 1, 100000]], code: ['trackingCode', 'manifestId'], notes: ['handlingNotes', 'instructions'], enums: { service: ['standard', 'express', 'freight'], destination: ['domestic', 'international'] } },
  { Ent: 'Booking', s: 'booking', p: 'bookings', text: ['guestName', 'partyName'], email: ['guestEmail', 'contactEmail'], num: [['guests', 1, 20], ['nights', 1, 30]], code: ['bookingRef', 'voucher'], notes: ['requests', 'notes'], enums: { roomType: ['single', 'double', 'suite'], meal: ['none', 'breakfast', 'half-board'] } },
  { Ent: 'Employee', s: 'employee', p: 'employees', text: ['fullName', 'displayName', 'managerName'], email: ['workEmail', 'personalEmail'], num: [['salaryBand', 1, 12], ['vacationDays', 0, 40]], code: ['employeeCode', 'badgeId'], notes: ['bio', 'notes'], enums: { department: ['finance', 'support', 'engineering', 'sales'], employmentType: ['full-time', 'part-time', 'contract'] } },
  { Ent: 'Course', s: 'course', p: 'courses', text: ['courseTitle', 'instructorName', 'moduleName'], email: ['instructorEmail', 'registrarEmail'], num: [['seats', 1, 300], ['credits', 1, 6]], code: ['courseCode', 'sectionId'], notes: ['syllabus', 'notes'], enums: { level: ['beginner', 'intermediate', 'advanced'], track: ['science', 'arts', 'business'] } },
];
const ADJ = ['Rush', 'Priority', 'Weekly', 'Archive', 'Draft', 'Open', 'Pending', 'Regional', 'Partner', 'Internal', 'Global', 'Quick', 'Bulk', 'Daily', 'Primary', 'Legacy', 'Trial', 'Premium', 'Remote', 'Secure', 'Shared', 'Field', 'Night', 'Spring', 'Core', 'Pilot', 'Retail', 'Express', 'Annual', 'Seasonal', 'Urgent', 'Managed', 'Linked', 'Scheduled', 'Audited', 'Verified', 'Fresh', 'Local', 'Direct', 'Metro'];
const CODE_PATTERNS = [
  { p: '^[A-Z]{3}-\\d{3}$', ex: 'ABC-123' },
  { p: '^[A-Z]{2}\\d{4}$', ex: 'AB1234' },
  { p: '^\\d{6}$', ex: '123456' },
  { p: '^[a-z0-9-]{4,12}$', ex: 'abc-123' },
  { p: '^[A-Z]{2}-\\d{2}-[A-Z]$', ex: 'XY-42-Q' },
];
const SAMPLE_TEXT = ['Northwind Trading', 'Blue Harbor Ltd', 'Orion Supply Co', 'Maple Street Group', 'Cedar Point Holdings'];
const SETTINGS = [
  { param: 'frequency', opts: ['daily', 'weekly', 'monthly'] },
  { param: 'sortOrder', opts: ['newest', 'oldest', 'alphabetical'] },
  { param: 'language', opts: ['en', 'fr', 'de', 'ar'] },
  { param: 'theme', opts: ['light', 'dark', 'system'] },
  { param: 'density', opts: ['compact', 'comfortable', 'spacious'] },
  { param: 'timezone', opts: ['UTC', 'Europe/London', 'Asia/Dubai', 'America/New_York'] },
  { param: 'exportFormat', opts: ['csv', 'xlsx', 'pdf'] },
];
const BOOLS = ['emailAlerts', 'autoArchive', 'weeklyDigest', 'requireApproval', 'showClosed', 'autoAssign', 'smsNotifications', 'lowStockWarnings'];
const ROWACTS = [
  { v: 'remove', label: 'Delete', status: null, past: 'removes' },
  { v: 'remove', label: 'Delete', status: null, past: 'removes' },
  { v: 'remove', label: 'Delete', status: null, past: 'removes' },
  { v: 'archive', label: 'Archive', status: 'archived' },
  { v: 'approve', label: 'Approve', status: 'approved' },
  { v: 'cancel', label: 'Cancel', status: 'cancelled' },
  { v: 'resolve', label: 'Resolve', status: 'resolved' },
  { v: 'close', label: 'Close', status: 'closed' },
];
const DETAIL_ACTS = [
  { v: 'approve', label: 'Approve', status: 'approved' }, { v: 'archive', label: 'Archive', status: 'archived' },
  { v: 'escalate', label: 'Escalate', status: 'escalated' }, { v: 'publish', label: 'Publish', status: 'published' },
  { v: 'activate', label: 'Activate', status: 'active' }, { v: 'suspend', label: 'Suspend', status: 'suspended' },
];
const GROUPS = ['admin', 'portal', 'workspace'];

// ---------- imports map ----------
const IMPORT_MAP = {
  Component: '@angular/core', Injectable: '@angular/core', inject: '@angular/core', signal: '@angular/core', computed: '@angular/core',
  output: '@angular/core', Output: '@angular/core', EventEmitter: '@angular/core', OnInit: '@angular/core',
  ReactiveFormsModule: '@angular/forms', FormsModule: '@angular/forms', FormBuilder: '@angular/forms', FormGroup: '@angular/forms', Validators: '@angular/forms', NgForm: '@angular/forms',
  NgFor: '@angular/common', NgIf: '@angular/common', Location: '@angular/common',
  Router: '@angular/router', ActivatedRoute: '@angular/router',
  MatButtonModule: '@angular/material/button', MatFormFieldModule: '@angular/material/form-field', MatInputModule: '@angular/material/input',
  MatSelectModule: '@angular/material/select', MatCheckboxModule: '@angular/material/checkbox', MatSlideToggleModule: '@angular/material/slide-toggle',
  MatTableModule: '@angular/material/table', MatPaginatorModule: '@angular/material/paginator', PageEvent: '@angular/material/paginator',
  MatTabsModule: '@angular/material/tabs', MatSortModule: '@angular/material/sort', Sort: '@angular/material/sort',
  MatButtonToggleModule: '@angular/material/button-toggle', MatRadioModule: '@angular/material/radio',
  MatDialog: '@angular/material/dialog', MatDialogModule: '@angular/material/dialog', MatDialogRef: '@angular/material/dialog',
  MatSnackBar: '@angular/material/snack-bar',
};

// ---------- registries / outputs ----------
const usedBases = new Set();
const truth = [];
const decoys = [];
const pages = []; // route entries
const files = new Map(); // relpath -> content
let opCounter = 0;

// ---------- Unit: builds one component ----------
class Unit {
  constructor(X, cls, style, tplUrl) {
    this.X = X; this.cls = cls; this.style = style; this.tplUrl = tplUrl;
    this.file = kebab(cls.replace(/Component$/, '')) + '.component';
    this.imps = new Set(); this.cimps = []; this.locals = new Map(); this.deps = [];
    this.members = []; this.ctorInit = []; this.methods = []; this.names = new Set(); this.impl = [];
    this.tpl = '';
  }
  need(...n) { for (const x of n) { if (!IMPORT_MAP[x]) throw new Error('no import for ' + x); this.imps.add(x); } }
  mod(...n) { this.need(...n); for (const x of n) if (!this.cimps.includes(x)) this.cimps.push(x); }
  local(rel, ...names) { if (!this.locals.has(rel)) this.locals.set(rel, new Set()); names.flat().forEach((x) => this.locals.get(rel).add(x)); }
  cmp(other) { this.local('./' + other.file, other.cls); if (!this.cimps.includes(other.cls)) this.cimps.push(other.cls); }
  dep(name, type, imp) { if (imp) this.need(imp); if (!this.deps.find((d) => d.name === name)) this.deps.push({ name, type }); }
  prop(name, type, expr, usesDeps = false) {
    if (type === 'FormGroup') this.need('FormGroup');
    if (this.names.has(name)) {
      this.members = this.members.filter((m) => !m.startsWith(name + ':') && !m.startsWith(name + ' ='));
      this.ctorInit = this.ctorInit.filter((m) => !m.startsWith('this.' + name + ' ='));
    }
    if (!usesDeps || this.style === 'inject') this.members.push(name + (type ? ': ' + type : '') + ' = ' + expr + ';');
    else { this.members.push(name + ': ' + (type || 'any') + ';'); this.ctorInit.push('this.' + name + ' = ' + expr + ';'); }
    this.names.add(name);
  }
  method(name, code) { this.methods.push(code); this.names.add(name); }
  onInit(body) { this.need('OnInit'); this.impl.push('OnInit'); this.method('ngOnInit', 'ngOnInit(): void {\n' + ind(body) + '\n}'); }
  render() {
    const byMod = new Map();
    for (const n of this.imps) { const m = IMPORT_MAP[n]; if (!byMod.has(m)) byMod.set(m, []); byMod.get(m).push(n); }
    if (this.style === 'inject' && this.deps.length) { if (!byMod.has('@angular/core')) byMod.set('@angular/core', []); byMod.get('@angular/core').push('inject'); }
    byMod.get('@angular/core') || byMod.set('@angular/core', []);
    byMod.get('@angular/core').push('Component');
    let out = '';
    for (const [m, ns] of byMod) out += 'import { ' + [...new Set(ns)].join(', ') + " } from '" + m + "';\n";
    for (const [rel, names] of this.locals) out += 'import { ' + [...names].join(', ') + " } from '" + rel + "';\n";
    const sel = 'app-' + kebab(this.cls.replace(/Component$/, ''));
    let meta = '  selector: ' + sq(sel) + ',\n';
    if (r.chance(0.3)) meta += '  standalone: true,\n';
    if (this.cimps.length) meta += '  imports: [' + this.cimps.join(', ') + '],\n';
    if (this.tplUrl) meta += '  templateUrl: ' + sq('./' + this.file + '.html') + ',\n';
    else meta += '  template: `\n' + this.tpl + '\n  `,\n';
    meta += '  styles: [`:host { display: block; padding: 12px; }`],\n';
    let body = '';
    if (this.style === 'inject') {
      body += this.deps.map((d) => '  private ' + d.name + ' = inject(' + d.type + ');').join('\n') + (this.deps.length ? '\n\n' : '');
      body += this.members.map((m) => ind(m)).join('\n') + (this.members.length ? '\n\n' : '');
    } else {
      body += this.members.map((m) => ind(m)).join('\n') + (this.members.length ? '\n\n' : '');
      if (this.deps.length || this.ctorInit.length) {
        body += '  constructor(' + this.deps.map((d) => 'private ' + d.name + ': ' + d.type).join(', ') + ') {\n' + this.ctorInit.map((l) => '    ' + l).join('\n') + (this.ctorInit.length ? '\n' : '') + '  }\n\n';
      }
    }
    body += this.methods.map((m) => ind(m)).join('\n\n');
    out += '\n@Component({\n' + meta + '})\nexport class ' + this.cls + (this.impl.length ? ' implements ' + this.impl.join(', ') : '') + ' {\n' + body + '\n}\n';
    return out;
  }
  write() {
    if (this.tplUrl) files.set('components/' + this.file + '.html', this.tpl.replace(/^ {4}/gm, '') + '\n');
    files.set('components/' + this.file + '.ts', this.render());
  }
}

// ---------- naming ----------
function makeX(key) {
  const E = r.pick(ENTS);
  let base, tries = 0;
  do {
    base = (tries < 60 ? r.pick(ADJ) : r.pick(ADJ) + r.pick(ADJ)) + E.Ent; tries++;
    if (tries > 200) base = base + String.fromCharCode(65 + r.int(0, 25)) + tries;
  } while (usedBases.has(base));
  usedBases.add(base);
  const X = {
    key, E, base, n: ++opCounter,
    style: r.chance(0.5) ? 'ctor' : 'inject', legacy: r.chance(0.35), tplUrl: r.chance(0.35),
    svc: base + r.pick(['Service', 'Store', 'Api', 'Repository', 'Manager']),
    rec: base + 'Record', input: base + 'Input',
    group: r.chance(0.25) ? r.pick(GROUPS) : null,
    lazy: r.chance(0.3),
    titleKey: r.pick(E.text),
    prefix: E.s.slice(0, 3),
  };
  X.svcFile = '../services/' + kebab(X.svc) + '.service';
  return X;
}
const mkUnit = (X, noun) => new Unit(X, X.base + noun + 'Component', X.style, X.tplUrl);

// ---------- fields ----------
function genFields(E, n, o = {}) {
  const used = new Set();
  const take = (arr) => { const c = arr.filter((x) => !used.has(x)); if (!c.length) return null; const v = r.pick(c); used.add(v); return v; };
  const mk = {
    text() { const name = take(E.text); if (!name) return null; return { name, kind: 'text', required: true, minLength: r.pick([2, 3, 4]), maxLength: r.pick([30, 50, 80, 100]) }; },
    email() { const name = take(E.email); if (!name) return null; return { name, kind: 'email', required: true }; },
    number() { const c = E.num.filter((x) => !used.has(x[0])); if (!c.length) return null; const e = r.pick(c); used.add(e[0]); return { name: e[0], kind: 'number', required: true, min: e[1], max: e[2] }; },
    code() { const name = take(E.code); if (!name) return null; const cp = r.pick(CODE_PATTERNS); return { name, kind: 'code', required: true, pattern: cp.p, ex: cp.ex }; },
    notes() { const name = take(E.notes); if (!name) return null; return { name, kind: 'notes', required: false, maxLength: r.pick([200, 300, 500]) }; },
    enum() { const keys = Object.keys(E.enums).filter((k) => !used.has(k)); if (!keys.length) return null; const k = r.pick(keys); used.add(k); return { name: k, kind: 'enum', required: true, options: E.enums[k] }; },
    bool() { const name = take(BOOLS); if (!name) return null; return { name, kind: 'bool', required: false }; },
  };
  const out = [mk.text()];
  if (o.forceEnum) out.push(mk.enum());
  if (o.forceBool) out.push(mk.bool());
  const kinds = ['text', 'email', 'number', 'number', 'code', 'notes', 'enum'];
  let guard = 0;
  while (out.length < n && guard++ < 40) { const f = mk[r.pick(kinds)](); if (f) out.push(f); }
  return r.shuffle(out.filter(Boolean));
}
const tsType = (f) => (f.kind === 'number' ? 'number' : f.kind === 'bool' ? 'boolean' : 'string');
function validValue(f) {
  switch (f.kind) {
    case 'text': { const s = r.pick(SAMPLE_TEXT); return s.slice(0, f.maxLength); }
    case 'email': return 'ops' + r.int(1, 99) + '@example.com';
    case 'number': return Math.min(f.max, Math.max(f.min, Math.round((f.min + f.max) / 2)));
    case 'code': return f.ex;
    case 'notes': return 'Handle with care';
    case 'enum': return f.options[0];
    case 'bool': return true;
  }
}
function propSchema(f) {
  switch (f.kind) {
    case 'text': return { type: 'string', minLength: f.minLength, maxLength: f.maxLength };
    case 'notes': return { type: 'string', maxLength: f.maxLength };
    case 'email': return { type: 'string', format: 'email' };
    case 'number': return { type: 'integer', minimum: f.min, maximum: f.max };
    case 'code': return { type: 'string', pattern: f.pattern };
    case 'enum': return { type: 'string', enum: f.options };
    case 'bool': return { type: 'boolean' };
  }
}
function schemaOf(fields = [], extraProps = {}, extraReq = []) {
  const properties = { ...extraProps }, required = [...extraReq];
  for (const f of fields) { properties[f.name] = propSchema(f); if (f.required) required.push(f.name); }
  return { type: 'object', properties, required, additionalProperties: false };
}
const validOf = (fields = [], extra = {}) => { const o = { ...extra }; for (const f of fields) o[f.name] = validValue(f); return o; };
const interfaceOf = (name, fields) => 'export interface ' + name + ' {\n' + fields.map((f) => '  ' + f.name + (f.required ? '' : '?') + ': ' + tsType(f) + ';').join('\n') + '\n}\n';
const optionDecls = (u, fields) => fields.filter((f) => f.kind === 'enum').forEach((f) => u.prop(f.name + 'Options', 'string[]', arrLit(f.options)));

// ---------- field renderers ----------
function optionsHtml(X, u, name, mat) {
  const tag = mat ? 'mat-option' : 'option';
  if (X.legacy) { u.mod('NgFor'); return '<' + tag + ' *ngFor="let o of ' + name + '" [value]="o">{{ o }}</' + tag + '>'; }
  return '@for (o of ' + name + '; track o) {\n  <' + tag + ' [value]="o">{{ o }}</' + tag + '>\n}';
}
function rfField(X, u, f, mat) {
  const L = human(f.name), n = f.name, itype = f.kind === 'number' ? 'number' : f.kind === 'email' ? 'email' : 'text';
  const err = '@if (form.get(' + sq(n) + ')?.invalid && form.get(' + sq(n) + ')?.touched) {\n  <small class="error">' + L + ' is invalid</small>\n}';
  if (mat) {
    u.mod('MatFormFieldModule', 'MatInputModule');
    if (f.kind === 'enum') { u.mod('MatSelectModule'); return '<mat-form-field>\n  <mat-label>' + L + '</mat-label>\n  <mat-select formControlName="' + n + '">\n' + ind(optionsHtml(X, u, n + 'Options', true), 4) + '\n  </mat-select>\n</mat-form-field>'; }
    if (f.kind === 'bool') { u.mod('MatCheckboxModule'); return '<mat-checkbox formControlName="' + n + '">' + L + '</mat-checkbox>'; }
    if (f.kind === 'notes') return '<mat-form-field>\n  <mat-label>' + L + '</mat-label>\n  <textarea matInput formControlName="' + n + '"></textarea>\n</mat-form-field>';
    return '<mat-form-field>\n  <mat-label>' + L + '</mat-label>\n  <input matInput type="' + itype + '" formControlName="' + n + '" />\n  <mat-error>' + L + ' is invalid</mat-error>\n</mat-form-field>';
  }
  if (f.kind === 'enum') return '<label>' + L + '\n  <select formControlName="' + n + '">\n    <option value="">Select...</option>\n' + ind(optionsHtml(X, u, n + 'Options', false), 4) + '\n  </select>\n</label>\n' + err;
  if (f.kind === 'bool') return '<label><input type="checkbox" formControlName="' + n + '" /> ' + L + '</label>';
  if (f.kind === 'notes') return '<label>' + L + '\n  <textarea formControlName="' + n + '"></textarea>\n</label>';
  return '<label>' + L + '\n  <input type="' + itype + '" formControlName="' + n + '" />\n</label>\n' + err;
}
function rfControls(fields) {
  return fields.map((f) => {
    const init = f.kind === 'number' ? 'null as number' : f.kind === 'bool' ? 'false' : "''";
    let v = [];
    if (f.kind === 'text') v = ['Validators.required', 'Validators.minLength(' + f.minLength + ')', 'Validators.maxLength(' + f.maxLength + ')'];
    if (f.kind === 'notes') v = ['Validators.maxLength(' + f.maxLength + ')'];
    if (f.kind === 'email') v = ['Validators.required', 'Validators.email'];
    if (f.kind === 'number') v = ['Validators.required', 'Validators.min(' + f.min + ')', 'Validators.max(' + f.max + ')'];
    if (f.kind === 'code') v = ['Validators.required', 'Validators.pattern(' + sq(f.pattern) + ')'];
    if (f.kind === 'enum') v = ['Validators.required'];
    return f.name + ': [' + init + ', [' + v.join(', ') + ']]';
  });
}
function tdAttrs(f) {
  if (f.kind === 'text') return 'required minlength="' + f.minLength + '" maxlength="' + f.maxLength + '"';
  if (f.kind === 'notes') return 'maxlength="' + f.maxLength + '"';
  if (f.kind === 'email') return 'required email';
  if (f.kind === 'number') return 'required min="' + f.min + '" max="' + f.max + '"';
  if (f.kind === 'code') return 'required pattern="' + f.pattern + '"';
  if (f.kind === 'enum') return 'required';
  return '';
}
// binding: ngModel expression for field; named: add name attr
function tdField(X, u, f, bind, named) {
  const L = human(f.name), n = f.name, nm = named ? ' name="' + n + '"' : '';
  const a = tdAttrs(f), itype = f.kind === 'number' ? 'number' : f.kind === 'email' ? 'email' : 'text';
  if (f.kind === 'enum') return '<label>' + L + '\n  <select [(ngModel)]="' + bind + '"' + nm + ' ' + a + '>\n    <option value="">Select...</option>\n' + ind(optionsHtml(X, u, n + 'Options', false), 4) + '\n  </select>\n</label>';
  if (f.kind === 'bool') return '<label><input type="checkbox" [(ngModel)]="' + bind + '"' + nm + ' /> ' + L + '</label>';
  if (f.kind === 'notes') return '<label>' + L + '\n  <textarea [(ngModel)]="' + bind + '"' + nm + ' ' + a + '></textarea>\n</label>';
  return '<label>' + L + '\n  <input type="' + itype + '" [(ngModel)]="' + bind + '"' + nm + ' ' + a + ' />\n</label>';
}
function manualChecks(fields, acc) {
  const out = [];
  for (const f of fields) {
    const v = acc(f.name);
    if (f.kind === 'text') out.push('if (!' + v + ' || ' + v + '.length < ' + f.minLength + ' || ' + v + '.length > ' + f.maxLength + ') { return; }');
    if (f.kind === 'notes') out.push('if (' + v + ' && ' + v + '.length > ' + f.maxLength + ') { return; }');
    if (f.kind === 'email') out.push('if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(' + v + ')) { return; }');
    if (f.kind === 'number') out.push('if (' + v + ' == null || ' + v + ' < ' + f.min + ' || ' + v + ' > ' + f.max + ') { return; }');
    if (f.kind === 'code') out.push('if (!new RegExp(' + sq(f.pattern) + ').test(' + v + ')) { return; }');
    if (f.kind === 'enum') out.push('if (!' + v + ') { return; }');
  }
  return out.join('\n');
}

// ---------- service builder ----------
const M = {
  create: (X, fields) => 'create(input: ' + X.input + '): ' + X.rec + ' {\n  const rec: ' + X.rec + " = { ...input, id: '" + X.prefix + "-' + this.seq++ };\n  this.items = [...this.items, rec];\n  return rec;\n}",
  update: (X) => 'update(id: string, input: ' + X.input + '): void {\n  this.items = this.items.map((i) => (i.id === id ? { ...i, ...input } : i));\n}',
  remove: () => 'remove(id: string): void {\n  this.items = this.items.filter((i) => i.id !== id);\n}',
  status: (name, status) => name + '(id: string): void {\n  this.items = this.items.map((i) => (i.id === id ? { ...i, status: ' + sq(status) + ' } : i));\n}',
};
function mkService(X, { fields = null, methods = [], seedCount = 4, extra = '' } = {}) {
  let pre, seed;
  if (fields) {
    pre = interfaceOf(X.input, fields) + '\nexport type ' + X.rec + ' = ' + X.input + ' & { id: string; status?: string };\n';
    const v = validOf(fields);
    seed = 'Array.from({ length: ' + seedCount + " }, (_, i): " + X.rec + ' => ({ ...' + JSON.stringify(v) + ", id: '" + X.prefix + "-' + (i + 1), status: 'open' }))";
  } else {
    pre = 'export interface ' + X.rec + ' {\n  id: string;\n  ' + X.titleKey + ': string;\n  status: string;\n}\n';
    seed = 'Array.from({ length: ' + seedCount + " }, (_, i): " + X.rec + " => ({ id: '" + X.prefix + "-' + (i + 1), " + X.titleKey + ": '" + X.E.Ent + " ' + (i + 1), status: 'open' }))";
  }
  if (fields) X.titleKey = (fields.find((f) => f.kind === 'text') || fields[0]).name;
  const body = [
    '  private items: ' + X.rec + '[] = ' + seed + ';',
    '  private seq = 100;',
    '',
    '  list(): ' + X.rec + '[] {\n    return [...this.items];\n  }',
    '',
    '  find(id: string): ' + X.rec + ' | undefined {\n    return this.items.find((i) => i.id === id);\n  }',
    ...methods.flatMap((m) => ['', ind(m)]),
    extra ? '\n' + ind(extra) : '',
  ].join('\n');
  const code = "import { Injectable } from '@angular/core';\n\n" + pre + "\n@Injectable({ providedIn: 'root' })\nexport class " + X.svc + ' {\n' + body + '\n}\n';
  files.set('services/' + kebab(X.svc) + '.service.ts', code);
}
// settings-style service (no records)
function mkSettingsService(X, methodsCode) {
  files.set('services/' + kebab(X.svc) + '.service.ts', "import { Injectable } from '@angular/core';\n\n@Injectable({ providedIn: 'root' })\nexport class " + X.svc + ' {\n  private prefs: Record<string, unknown> = {};\n\n' + methodsCode.map((m) => ind(m)).join('\n\n') + '\n}\n');
}

// ---------- routes / truth ----------
function fullPath(X, p) { return '/' + (X.group ? X.group + '/' : '') + p; }
function addRoute(X, u, p) {
  pages.push({ path: p, group: X.group, cls: u.cls, file: u.file, lazy: X.lazy });
  return fullPath(X, p);
}
function addTruth(X, t) {
  truth.push({ id: t.idiom + '-' + X.n + (t.suffix ? '-' + t.suffix : ''), idiom: t.idiom, component: t.component, handler: t.handler, routes: t.routes, inputSchema: t.inputSchema, validInput: t.validInput, effect: t.effect, ...(t.notes ? { notes: t.notes } : {}) });
}
const emptySchema = () => ({ type: 'object', properties: {}, required: [], additionalProperties: false });

// ---------- decoys ----------
function applyDecoys(X, u, force) {
  if (!force && !r.chance(0.3)) return '';
  const opts = r.shuffle(['nav', 'loc', 'toggle', 'log', 'docs', 'print']);
  const k = opts.slice(0, r.int(1, 2));
  let html = '';
  const reg = (h, why) => decoys.push({ component: u.cls, handler: h, why });
  for (const o of k) {
    if (o === 'nav') {
      const h = r.pick(['goBack', 'backToList', 'navigateHome', 'returnToDashboard']); if (u.names.has(h)) continue;
      u.dep('router', 'Router', 'Router'); u.method(h, h + "(): void {\n  this.router.navigate(['/']);\n}");
      html += '\n<button type="button" (click)="' + h + '()">Back</button>'; reg(h, 'pure navigation via Router.navigate, no state change');
    } else if (o === 'loc') {
      const h = r.pick(['goPrevious', 'historyBack']); if (u.names.has(h)) continue;
      u.dep('location', 'Location', 'Location'); u.method(h, h + '(): void {\n  this.location.back();\n}');
      html += '\n<a href="#" (click)="' + h + '(); $event.preventDefault()">Previous page</a>'; reg(h, 'pure navigation via Location.back');
    } else if (o === 'toggle') {
      const h = r.pick(['toggleHelp', 'toggleDetails', 'toggleAdvanced', 'expandNotes']); if (u.names.has(h)) continue;
      const flag = 'show' + cap(h.replace(/^(toggle|expand)/, ''));
      u.prop(flag, 'boolean', 'false'); u.method(h, h + '(): void {\n  this.' + flag + ' = !this.' + flag + ';\n}');
      if (X.legacy) { u.mod('NgIf'); html += '\n<button type="button" (click)="' + h + '()">Toggle</button>\n<p *ngIf="' + flag + '" class="hint">Extra information shown on demand.</p>'; }
      else html += '\n<button type="button" (click)="' + h + '()">Toggle</button>\n@if (' + flag + ') {\n  <p class="hint">Extra information shown on demand.</p>\n}';
      reg(h, 'display-only boolean toggle for local presentation');
    } else if (o === 'log') {
      const h = r.pick(['trackClick', 'logAction', 'onHover']); if (u.names.has(h)) continue;
      u.method(h, h + "(): void {\n  console.log('" + u.cls + " interaction');\n}");
      html += '\n<button type="button" (mouseenter)="' + h + '()" (click)="' + h + '()">Info</button>'; reg(h, 'console logging only');
    } else if (o === 'docs') {
      const h = 'openDocs'; if (u.names.has(h)) continue;
      u.method(h, "openDocs(): void {\n  window.open('https://example.com/docs', '_blank');\n}");
      html += '\n<button type="button" (click)="openDocs()">Docs</button>'; reg(h, 'opens external documentation window, no state');
    } else if (o === 'print') {
      const h = 'printPage'; if (u.names.has(h)) continue;
      u.method(h, 'printPage(): void {\n  window.print();\n}');
      html += '\n<button type="button" (click)="printPage()">Print</button>'; reg(h, 'browser print dialog, no state');
    }
  }
  return html;
}
function setTpl(X, u, title, content, decoyForce = false) {
  const extra = applyDecoys(X, u, decoyForce);
  const inner = '<h2>' + title + '</h2>\n' + content + extra;
  u.tpl = ind('<section class="page">\n' + ind(inner) + '\n</section>', 4);
}

const pickHandler = (...c) => r.pick(c);
const hName = (E, base) => r.pick([base, base + cap(E.s), 'on' + cap(base)]);

// ---------- row list core ----------
function rowActionPick() { return r.pick(ROWACTS); }
function rowSvcMethod(X, act) { return act.status ? M.status(act.v, act.status) : M.remove(); }
function rowHandler(X, u, act, paramStyle, svcMethodName) {
  const h = hName(X.E, act.v === 'remove' ? r.pick(['remove', 'deleteRow', 'delete' + X.E.Ent]) : act.v);
  const finalName = h === 'remove' && act.v !== 'remove' ? act.v : h;
  const refresh = 'this.rows = this.svc.list();';
  let code;
  if (paramStyle === 'id') code = finalName + '(id: string): void {\n  this.svc.' + svcMethodName + '(id);\n  ' + refresh + '\n}';
  else code = finalName + '(row: ' + X.rec + '): void {\n  this.svc.' + svcMethodName + '(row.id);\n  ' + refresh + '\n}';
  u.method(finalName, code);
  return finalName;
}
function rowTruth(X, u, idiom, handler, act, paramStyle, route) {
  const pname = paramStyle === 'id' && r.chance(0.5) ? 'id' : X.E.s + 'Id';
  addTruth(X, {
    idiom, component: u.cls, handler, routes: [route],
    inputSchema: { type: 'object', properties: { [pname]: { type: 'string' } }, required: [pname], additionalProperties: false },
    validInput: { [pname]: X.prefix + '-1' },
    effect: X.svc + '.' + (act.status ? act.v : 'remove') + '(id) ' + (act.status ? 'sets the ' + X.E.s + ' status to ' + act.status : 'deletes the ' + X.E.s),
  });
}
function baseRowUnit(X, noun, svcMethods, seedCount = 4) {
  const u = mkUnit(X, noun);
  u.dep('svc', X.svc); u.local(X.svcFile, X.svc, X.rec);
  u.prop('rows', X.rec + '[]', 'this.svc.list()', true);
  return u;
}

// ================= IDIOM BUILDERS =================

// 1 & 24: reactive form (+ variants)
function bReactive(X, o = {}) {
  const E = X.E;
  const u = mkUnit(X, r.pick(['Form', 'Editor', 'Intake', 'Registration', 'Entry']));
  const fields = genFields(E, r.int(3, 6), o);
  const mat = o.mat ?? r.chance(0.3);
  mkService(X, { fields, methods: [M.create(X, fields)] });
  u.mod('ReactiveFormsModule'); u.need('Validators', 'FormBuilder');
  u.dep('fb', 'FormBuilder'); u.dep('svc', X.svc); u.local(X.svcFile, X.svc, X.input);
  optionDecls(u, fields);
  u.prop('form', 'FormGroup', 'this.fb.group({\n  ' + rfControls(fields).join(',\n  ') + '\n})', true);
  const h = r.pick(['save', 'submit', 'onSubmit', 'save' + E.Ent, 'create' + E.Ent, 'submitForm']);
  const variant = r.int(0, 3);
  let code;
  if (variant === 0) code = h + '(): void {\n  if (this.form.invalid) {\n    this.form.markAllAsTouched();\n    return;\n  }\n  this.svc.create(this.form.getRawValue() as ' + X.input + ');\n  this.form.reset();\n}';
  else if (variant === 1) {
    u.prop('lastId', 'string', "''");
    u.method('persist', 'private persist(value: ' + X.input + '): void {\n  const created = this.svc.create(value);\n  this.lastId = created.id;\n}');
    code = h + '(): void {\n  if (this.form.invalid) {\n    return;\n  }\n  this.persist(this.form.value as ' + X.input + ');\n}';
  } else if (variant === 2) {
    code = h + '(): void {\n  if (!this.form.valid) {\n    return;\n  }\n  const { ' + fields.map((f) => f.name).join(', ') + ' } = this.form.value;\n  this.svc.create({ ' + fields.map((f) => f.name).join(', ') + ' });\n}';
  } else {
    u.dep('snack', 'MatSnackBar', 'MatSnackBar');
    code = h + '(): void {\n  if (this.form.invalid) {\n    this.form.markAllAsTouched();\n    return;\n  }\n  const created = this.svc.create(this.form.getRawValue() as ' + X.input + ');\n  this.snack.open(\'Saved \' + created.id, \'OK\', { duration: 2000 });\n}';
  }
  u.method(h, code);
  if (mat) u.mod('MatButtonModule');
  const content = '<form [formGroup]="form" (ngSubmit)="' + h + '()">\n' + ind(fields.map((f) => rfField(X, u, f, mat)).join('\n')) + '\n  <button ' + (mat ? 'mat-flat-button ' : '') + 'type="submit">Save</button>\n</form>';
  setTpl(X, u, human(E.s) + ' form', content);
  const route = addRoute(X, u, kebab(u.cls.replace(/Component$/, '')));
  u.write();
  addTruth(X, { idiom: o.idiom || 'reactive-form', component: u.cls, handler: h, routes: [route], inputSchema: schemaOf(fields), validInput: validOf(fields), effect: X.svc + '.create(input) stores a new ' + E.s });
}

// 2: template-driven ngModel + ngSubmit
function bTdForm(X) {
  const E = X.E;
  const u = mkUnit(X, r.pick(['Form', 'Intake', 'Capture', 'Registration']));
  const fields = genFields(E, r.int(3, 5), { forceEnum: r.chance(0.5), forceBool: r.chance(0.3) });
  mkService(X, { fields, methods: [M.create(X, fields)] });
  u.mod('FormsModule'); u.need('NgForm');
  u.dep('svc', X.svc); u.local(X.svcFile, X.svc, X.input);
  optionDecls(u, fields);
  const init = fields.map((f) => f.name + ': ' + (f.kind === 'number' ? 'null' : f.kind === 'bool' ? 'false' : "''")).join(', ');
  u.prop('model', X.input, '{ ' + init + ' }');
  const h = r.pick(['onSubmit', 'submit', 'save', 'add' + E.Ent]);
  const v = r.int(0, 1);
  u.method(h, v === 0 ? h + '(form: NgForm): void {\n  if (form.invalid) {\n    return;\n  }\n  this.svc.create(this.model);\n  form.resetForm();\n}' : h + '(form: NgForm): void {\n  if (!form.valid) {\n    return;\n  }\n  this.persist();\n}');
  if (v === 1) u.method('persist', 'private persist(): void {\n  this.svc.create({ ...this.model });\n}');
  const content = '<form #f="ngForm" (ngSubmit)="' + h + '(f)">\n' + ind(fields.map((x) => tdField(X, u, x, 'model.' + x.name, true)).join('\n')) + '\n  <button type="submit" [disabled]="f.invalid">Submit</button>\n</form>';
  setTpl(X, u, 'New ' + E.s, content);
  const route = addRoute(X, u, kebab(u.cls.replace(/Component$/, '')));
  u.write();
  addTruth(X, { idiom: 'template-form-ngmodel', component: u.cls, handler: h, routes: [route], inputSchema: schemaOf(fields), validInput: validOf(fields), effect: X.svc + '.create(model) stores a new ' + E.s });
}

// 3: ngModel fields + plain click button
function bTdClick(X) {
  const E = X.E;
  const u = mkUnit(X, r.pick(['QuickAdd', 'Composer', 'Panel', 'Wizard']));
  const fields = genFields(E, r.int(2, 4), { forceEnum: r.chance(0.4) });
  mkService(X, { fields, methods: [M.create(X, fields)] });
  u.mod('FormsModule');
  u.dep('svc', X.svc); u.local(X.svcFile, X.svc, X.input);
  optionDecls(u, fields);
  for (const f of fields) u.prop(f.name, tsType(f), f.kind === 'number' ? 'null' : f.kind === 'bool' ? 'false' : "''");
  const h = r.pick(['register', 'addNew', 'submit', 'createRecord', 'saveDraft']);
  const checks = manualChecks(fields, (n) => 'this.' + n);
  const obj = '{ ' + fields.map((f) => f.name + ': this.' + f.name).join(', ') + ' }';
  u.method(h, h + '(): void {\n' + ind(checks) + '\n  this.svc.create(' + obj + ');\n' + ind(fields.map((f) => 'this.' + f.name + ' = ' + (f.kind === 'number' ? 'null' : f.kind === 'bool' ? 'false' : "''") + ';').join('\n')) + '\n}');
  const content = '<div class="fields">\n' + ind(fields.map((f) => tdField(X, u, f, f.name, false)).join('\n')) + '\n</div>\n<button type="button" (click)="' + h + '()">Add</button>';
  setTpl(X, u, 'Add ' + E.s, content);
  const route = addRoute(X, u, kebab(u.cls.replace(/Component$/, '')));
  u.write();
  addTruth(X, { idiom: 'template-fields-click', component: u.cls, handler: h, routes: [route], inputSchema: schemaOf(fields), validInput: validOf(fields), effect: X.svc + '.create(input) stores a new ' + E.s });
}

// 4/5/25/27: row list with action
function bRowList(X, flavor) {
  const E = X.E;
  const act = flavor === 'confirm' ? ROWACTS[0] : rowActionPick();
  const u = baseRowUnit(X, r.pick(['List', 'Manager', 'Board', 'Console', 'Overview']));
  mkService(X, { methods: [rowSvcMethod(X, act)], seedCount: 4 });
  const paramStyle = r.pick(['id', 'row']);
  let handler = rowHandler(X, u, act, paramStyle, act.status ? act.v : 'remove');
  const arg = paramStyle === 'id' ? 'row.id' : 'row';
  if (flavor === 'confirm') {
    const m = u.methods.pop();
    u.methods.push(m.replace('{\n  this.svc', "{\n  if (!window.confirm('Delete this " + E.s + "?')) {\n    return;\n  }\n  this.svc"));
  }
  let content;
  const t = X.titleKey;
  if (flavor === 'nested') {
    u.method('hasOpen', 'hasOpen(): boolean {\n  return this.rows.some((r) => r.status === \'open\');\n}');
    content = '@if (rows.length > 0) {\n  <ul>\n    @for (row of rows; track row.id) {\n      @if (row.status !== \'closed\') {\n        <li>\n          <span>{{ row.' + t + ' }}</span>\n          @switch (row.status) {\n            @case (\'open\') {\n              <em>open</em>\n              <button type="button" (click)="' + handler + '(' + arg + ')">' + act.label + '</button>\n            }\n            @default {\n              <em>{{ row.status }}</em>\n            }\n          }\n        </li>\n      }\n    }\n  </ul>\n} @else {\n  <p>No ' + E.p + ' yet.</p>\n}';
  } else if (flavor === 'for' || (flavor === 'confirm' && !X.legacy)) {
    content = '<ul>\n  @for (row of rows; track row.id) {\n    <li>\n      {{ row.' + t + ' }} ({{ row.status }})\n      <button type="button" (click)="' + handler + '(' + arg + ')">' + act.label + '</button>\n    </li>\n  }\n  @empty {\n    <li>No ' + E.p + '</li>\n  }\n</ul>';
  } else {
    u.mod('NgFor');
    content = '<ul>\n  <li *ngFor="let row of rows; trackBy: trackById">\n    {{ row.' + t + ' }} ({{ row.status }})\n    <button type="button" (click)="' + handler + '(' + arg + ')">' + act.label + '</button>\n  </li>\n</ul>';
    u.method('trackById', 'trackById(_index: number, row: ' + X.rec + '): string {\n  return row.id;\n}');
  }
  setTpl(X, u, human(E.p), content);
  const route = addRoute(X, u, kebab(u.cls.replace(/Component$/, '')));
  u.write();
  const idiom = { for: 'list-row-action-at-for', ngfor: 'list-row-action-ngfor', nested: 'nested-control-flow', confirm: 'confirm-delete' }[flavor];
  rowTruth(X, u, idiom, handler, act, paramStyle, route);
}

// 6: mat-table row action
function bMatTable(X) {
  const E = X.E, act = rowActionPick();
  const u = baseRowUnit(X, r.pick(['Table', 'Grid', 'Register']));
  mkService(X, { methods: [rowSvcMethod(X, act)] });
  const paramStyle = r.pick(['id', 'row']);
  const handler = rowHandler(X, u, act, paramStyle, act.status ? act.v : 'remove');
  u.mod('MatTableModule', 'MatButtonModule');
  u.prop('columns', 'string[]', arrLit([X.titleKey, 'status', 'actions']));
  const arg = paramStyle === 'id' ? 'row.id' : 'row';
  const col = (n, h, c) => '<ng-container matColumnDef="' + n + '">\n  <th mat-header-cell *matHeaderCellDef>' + h + '</th>\n  <td mat-cell *matCellDef="let row">' + c + '</td>\n</ng-container>';
  const content = '<table mat-table [dataSource]="rows">\n' + ind(col(X.titleKey, human(X.titleKey), '{{ row.' + X.titleKey + ' }}') + '\n' + col('status', 'Status', '{{ row.status }}') + '\n' + col('actions', '', '<button mat-button (click)="' + handler + '(' + arg + ')">' + act.label + '</button>') + '\n<tr mat-header-row *matHeaderRowDef="columns"></tr>\n<tr mat-row *matRowDef="let row; columns: columns"></tr>') + '\n</table>';
  setTpl(X, u, human(E.p) + ' table', content);
  const route = addRoute(X, u, kebab(u.cls.replace(/Component$/, '')));
  u.write();
  rowTruth(X, u, 'mat-table-row-action', handler, act, paramStyle, route);
}

// 7: detail page with action using route id
function bDetail(X) {
  const E = X.E, act = r.pick(DETAIL_ACTS);
  const u = mkUnit(X, r.pick(['Detail', 'Profile', 'Overview', 'Details']));
  mkService(X, { methods: [M.status(act.v, act.status)] });
  const P = r.pick(['id', E.s + 'Id']);
  u.dep('route', 'ActivatedRoute', 'ActivatedRoute'); u.dep('svc', X.svc); u.local(X.svcFile, X.svc, X.rec);
  u.prop('id', 'string', "''"); u.prop('record', X.rec + ' | undefined', 'undefined');
  if (r.chance(0.5)) u.onInit("this.id = this.route.snapshot.paramMap.get('" + P + "') ?? '';\nthis.record = this.svc.find(this.id);");
  else u.onInit("this.route.paramMap.subscribe((params) => {\n  this.id = params.get('" + P + "') ?? '';\n  this.record = this.svc.find(this.id);\n});");
  const h = r.pick([act.v, 'on' + cap(act.v), act.v + cap(E.s), 'markAs' + cap(act.status)]);
  u.method(h, h + '(): void {\n  this.svc.' + act.v + '(this.id);\n  this.record = this.svc.find(this.id);\n}');
  const content = (X.legacy ? '<div *ngIf="record">' : '@if (record) {\n<div>') + '\n  <p>{{ record.' + X.titleKey + ' }} - {{ record.status }}</p>\n  <button type="button" (click)="' + h + '()">' + cap(act.v) + '</button>\n</div>' + (X.legacy ? '' : '\n}');
  if (X.legacy) u.mod('NgIf');
  setTpl(X, u, human(E.s) + ' detail', content);
  const route = addRoute(X, u, kebab(u.cls.replace(/Component$/, '')) + '/:' + P);
  u.write();
  addTruth(X, { idiom: 'detail-route-action', component: u.cls, handler: h, routes: [route], inputSchema: { type: 'object', properties: { [P]: { type: 'string' } }, required: [P], additionalProperties: false }, validInput: { [P]: X.prefix + '-1' }, effect: X.svc + '.' + act.v + '(id) sets the ' + E.s + ' status to ' + act.status });
}

// 8 & 26 & 17-ish: choice settings: select / radio / button-toggle
function bChoice(X, kind) {
  const E = X.E, S = r.pick(SETTINGS);
  const u = mkUnit(X, r.pick(['Settings', 'Preferences', 'Options']));
  const m = r.pick(['set' + E.Ent + cap(S.param), 'update' + cap(S.param), 'save' + cap(S.param)]);
  mkSettingsService(X, [m + '(' + S.param + ': string): void {\n  this.prefs[' + sq(S.param) + '] = ' + S.param + ';\n}', 'current(): string {\n  return String(this.prefs[' + sq(S.param) + '] ?? ' + sq(S.opts[0]) + ');\n}']);
  u.dep('svc', X.svc); u.local(X.svcFile, X.svc);
  const oname = r.pick([S.param + 'Options', S.param + 's', 'options']);
  u.prop(oname, 'string[]', arrLit(S.opts));
  u.prop('selected', 'string', 'this.svc.current()', true);
  const h = r.pick(['onChange', 'on' + cap(S.param) + 'Change', 'change' + cap(S.param), 'select' + cap(S.param)]);
  const body = r.chance(0.5) ? h + '(' + S.param + ': string): void {\n  this.selected = ' + S.param + ';\n  this.svc.' + m + '(' + S.param + ');\n}' : h + '(' + S.param + ': string): void {\n  this.apply(' + S.param + ');\n}';
  u.method(h, body);
  if (body.includes('this.apply')) u.method('apply', 'private apply(value: string): void {\n  this.selected = value;\n  this.svc.' + m + '(value);\n}');
  let content, idiom;
  if (kind === 'select') {
    if (r.chance(0.5)) { idiom = 'select-setting'; content = '<label>' + human(S.param) + '\n  <select [value]="selected" (change)="' + h + '($any($event.target).value)">\n' + ind(optionsHtmlRaw(X, u, oname, false), 4) + '\n  </select>\n</label>'; }
    else { idiom = 'select-setting'; u.mod('MatSelectModule', 'MatFormFieldModule'); content = '<mat-form-field>\n  <mat-label>' + human(S.param) + '</mat-label>\n  <mat-select [value]="selected" (selectionChange)="' + h + '($event.value)">\n' + ind(optionsHtmlRaw(X, u, oname, true), 4) + '\n  </mat-select>\n</mat-form-field>'; }
  } else if (kind === 'radio') {
    idiom = 'radio-setting'; u.mod('MatRadioModule');
    content = '<mat-radio-group [value]="selected" (change)="' + h + '($event.value)">\n  @for (o of ' + oname + '; track o) {\n    <mat-radio-button [value]="o">{{ o }}</mat-radio-button>\n  }\n</mat-radio-group>';
  } else {
    idiom = 'button-toggle-setting'; u.mod('MatButtonToggleModule');
    content = '<mat-button-toggle-group [value]="selected" (change)="' + h + '($event.value)">\n  @for (o of ' + oname + '; track o) {\n    <mat-button-toggle [value]="o">{{ o }}</mat-button-toggle>\n  }\n</mat-button-toggle-group>';
  }
  setTpl(X, u, human(E.s) + ' ' + human(S.param), content);
  const route = addRoute(X, u, kebab(u.cls.replace(/Component$/, '')));
  u.write();
  addTruth(X, { idiom, component: u.cls, handler: h, routes: [route], inputSchema: { type: 'object', properties: { [S.param]: { type: 'string', enum: S.opts } }, required: [S.param], additionalProperties: false }, validInput: { [S.param]: S.opts[1] }, effect: X.svc + '.' + m + '(' + S.param + ') persists the ' + E.s + ' ' + S.param + ' preference' });
}
function optionsHtmlRaw(X, u, arrName, mat) { return optionsHtml(X, u, arrName, mat); }

// 9: checkbox / slide toggle
function bToggle(X) {
  const E = X.E, B = r.pick(BOOLS);
  const u = mkUnit(X, r.pick(['Settings', 'Notifications', 'Preferences']));
  const m = r.pick(['set' + cap(B), 'toggle' + cap(B), 'save' + cap(B)]);
  mkSettingsService(X, [m + '(' + B + ': boolean): void {\n  this.prefs[' + sq(B) + '] = ' + B + ';\n}', 'isEnabled(): boolean {\n  return Boolean(this.prefs[' + sq(B) + ']);\n}']);
  u.dep('svc', X.svc); u.local(X.svcFile, X.svc);
  u.prop('enabled', 'boolean', 'this.svc.isEnabled()', true);
  const h = r.pick(['onToggle', 'on' + cap(B) + 'Change', 'toggle' + cap(B), 'setEnabled']);
  u.method(h, h + '(' + B + ': boolean): void {\n  this.enabled = ' + B + ';\n  this.svc.' + m + '(' + B + ');\n}');
  let content;
  if (r.chance(0.5)) content = '<label>\n  <input type="checkbox" [checked]="enabled" (change)="' + h + '($any($event.target).checked)" />\n  ' + human(B) + '\n</label>';
  else { u.mod('MatSlideToggleModule'); content = '<mat-slide-toggle [checked]="enabled" (change)="' + h + '($event.checked)">' + human(B) + '</mat-slide-toggle>'; }
  setTpl(X, u, human(E.s) + ' settings', content);
  const route = addRoute(X, u, kebab(u.cls.replace(/Component$/, '')));
  u.write();
  addTruth(X, { idiom: 'toggle-setting', component: u.cls, handler: h, routes: [route], inputSchema: { type: 'object', properties: { [B]: { type: 'boolean' } }, required: [B], additionalProperties: false }, validInput: { [B]: true }, effect: X.svc + '.' + m + '(' + B + ') persists the ' + human(B) + ' preference' });
}

// 10: search input
function bSearch(X) {
  const E = X.E;
  const u = baseRowUnit(X, r.pick(['Search', 'Finder', 'Lookup', 'Browser']));
  const gate = r.chance(0.5) ? 2 : 0;
  mkService(X, { methods: ['search(query: string): ' + X.rec + '[] {\n  const q = query.toLowerCase();\n  this.lastQuery = q;\n  return this.items.filter((i) => i.' + X.titleKey + '.toLowerCase().includes(q));\n}'], extra: 'lastQuery = \'\';' });
  u.prop('results', X.rec + '[]', 'this.svc.list()', true);
  const h = r.pick(['onSearch', 'search', 'filterList', 'onQueryInput']);
  u.method(h, h + '(query: string): void {\n' + (gate ? '  if (query.trim().length < ' + gate + ') {\n    this.results = [];\n    return;\n  }\n' : '') + '  this.results = this.svc.search(query);\n}');
  const content = '<input type="search" placeholder="Search ' + E.p + '" (input)="' + h + '($any($event.target).value)" />\n<ul>\n  @for (item of results; track item.id) {\n    <li>{{ item.' + X.titleKey + ' }}</li>\n  }\n</ul>';
  setTpl(X, u, 'Find ' + E.p, content);
  const route = addRoute(X, u, kebab(u.cls.replace(/Component$/, '')));
  u.write();
  addTruth(X, { idiom: 'search-input', component: u.cls, handler: h, routes: [route], inputSchema: { type: 'object', properties: { query: gate ? { type: 'string', minLength: gate } : { type: 'string' } }, required: ['query'], additionalProperties: false }, validInput: { query: 'north' }, effect: X.svc + '.search(query) filters ' + E.p + ' and records the last query' });
}

// 11: dialog with reactive form
function bDialog(X) {
  const E = X.E;
  const fields = genFields(E, r.int(2, 4), { forceEnum: r.chance(0.4) });
  mkService(X, { fields, methods: [M.create(X, fields)] });
  const host = mkUnit(X, r.pick(['Manager', 'Board', 'Catalog']));
  const dlg = new Unit(X, X.base + 'Dialog' + 'Component', X.style, r.chance(0.3));
  // dialog
  dlg.mod('ReactiveFormsModule', 'MatDialogModule', 'MatButtonModule'); dlg.need('Validators', 'FormBuilder');
  dlg.dep('fb', 'FormBuilder'); dlg.dep('svc', X.svc); dlg.dep('ref', 'MatDialogRef<' + dlg.cls + '>', 'MatDialogRef'); dlg.local(X.svcFile, X.svc, X.input);
  optionDecls(dlg, fields);
  dlg.prop('form', 'FormGroup', 'this.fb.group({\n  ' + rfControls(fields).join(',\n  ') + '\n})', true);
  const h = r.pick(['save', 'submit', 'confirmCreate', 'onSave']);
  if (r.chance(0.5)) dlg.method(h, h + '(): void {\n  if (this.form.invalid) {\n    return;\n  }\n  const created = this.svc.create(this.form.getRawValue() as ' + X.input + ');\n  this.ref.close(created);\n}');
  else { dlg.method(h, h + '(): void {\n  if (this.form.invalid) {\n    return;\n  }\n  this.commit(this.form.getRawValue());\n}'); dlg.method('commit', 'private commit(value: ' + X.input + '): void {\n  this.svc.create(value);\n  this.ref.close(true);\n}'); }
  dlg.method('close', 'close(): void {\n  this.ref.close();\n}');
  dlg.tpl = ind('<h2 mat-dialog-title>New ' + E.s + '</h2>\n<form [formGroup]="form" (ngSubmit)="' + h + '()">\n  <mat-dialog-content>\n' + ind(fields.map((f) => rfField(X, dlg, f, false)).join('\n'), 4) + '\n  </mat-dialog-content>\n  <mat-dialog-actions>\n    <button mat-button type="button" (click)="close()">Cancel</button>\n    <button mat-flat-button type="submit">Save</button>\n  </mat-dialog-actions>\n</form>', 4);
  dlg.write();
  decoys.push({ component: dlg.cls, handler: 'close', why: 'closes the dialog without persisting anything' });
  // host
  host.mod('MatDialogModule', 'MatButtonModule');
  host.dep('dialog', 'MatDialog', 'MatDialog'); host.dep('svc', X.svc); host.local(X.svcFile, X.svc, X.rec);
  host.local('./' + dlg.file, dlg.cls);
  host.prop('rows', X.rec + '[]', 'this.svc.list()', true);
  host.method('openDialog', 'openDialog(): void {\n  this.dialog\n    .open(' + dlg.cls + ", { width: '420px' })\n    .afterClosed()\n    .subscribe(() => {\n      this.rows = this.svc.list();\n    });\n}");
  decoys.push({ component: host.cls, handler: 'openDialog', why: 'only opens the dialog; persistence happens in the dialog component' });
  setTpl(X, host, human(E.p), '<button mat-flat-button type="button" (click)="openDialog()">New ' + E.s + '</button>\n<ul>\n  @for (row of rows; track row.id) {\n    <li>{{ row.' + X.titleKey + ' }}</li>\n  }\n</ul>');
  const route = addRoute(X, host, kebab(host.cls.replace(/Component$/, '')));
  host.write();
  addTruth(X, { idiom: 'dialog-form', component: dlg.cls, handler: h, routes: [route], inputSchema: schemaOf(fields), validInput: validOf(fields), effect: X.svc + '.create(input) stores a new ' + E.s + ' from a MatDialog form opened on ' + host.cls, notes: 'Handler lives on the dialog component (not routed); reachable from the host page route.' });
}

// 12: child output -> parent persists
function bChildOutput(X) {
  const E = X.E;
  const fields = genFields(E, r.int(2, 3), { forceEnum: r.chance(0.3) });
  mkService(X, { fields, methods: [M.create(X, fields)] });
  const child = new Unit(X, X.base + 'QuickForm' + 'Component', X.style, false);
  const parent = mkUnit(X, r.pick(['Page', 'Workspace', 'Hub']));
  child.mod('ReactiveFormsModule'); child.need('Validators', 'FormBuilder');
  child.dep('fb', 'FormBuilder'); child.local(X.svcFile, X.input);
  optionDecls(child, fields);
  child.prop('form', 'FormGroup', 'this.fb.group({\n  ' + rfControls(fields).join(',\n  ') + '\n})', true);
  const modern = r.chance(0.5);
  if (modern) { child.need('output'); child.prop('submitted', null, 'output<' + X.input + '>()'); }
  else { child.need('Output', 'EventEmitter'); child.members.push('@Output() submitted = new EventEmitter<' + X.input + '>();'); }
  child.method('send', 'send(): void {\n  if (this.form.invalid) {\n    return;\n  }\n  this.submitted.emit(this.form.getRawValue() as ' + X.input + ');\n  this.form.reset();\n}');
  child.tpl = ind('<form [formGroup]="form" (ngSubmit)="send()">\n' + ind(fields.map((f) => rfField(X, child, f, false)).join('\n')) + '\n  <button type="submit">Add</button>\n</form>', 4);
  child.write();
  parent.cmp(child);
  parent.dep('svc', X.svc); parent.local(X.svcFile, X.svc, X.input, X.rec);
  parent.prop('rows', X.rec + '[]', 'this.svc.list()', true);
  const h = r.pick(['onCreated', 'handleSubmit', 'addFromChild', 'onChildSubmitted']);
  parent.method(h, h + '(payload: ' + X.input + '): void {\n  this.svc.create(payload);\n  this.rows = this.svc.list();\n}');
  setTpl(X, parent, human(E.p), '<app-' + kebab(child.cls.replace(/Component$/, '')) + ' (submitted)="' + h + '($event)" />\n<ul>\n  @for (row of rows; track row.id) {\n    <li>{{ row.' + X.titleKey + ' }}</li>\n  }\n</ul>');
  const route = addRoute(X, parent, kebab(parent.cls.replace(/Component$/, '')));
  parent.write();
  addTruth(X, { idiom: 'child-output-parent-handler', component: parent.cls, handler: h, routes: [route], inputSchema: schemaOf(fields), validInput: validOf(fields), effect: X.svc + '.create(payload) stores a ' + E.s + ' emitted by child ' + child.cls, notes: 'The child form enforces the validators; the child send() only emits and is not itself a persisting operation.' });
}

// 13: query param on init
function bQueryParam(X) {
  const E = X.E;
  const T = r.pick(['token', 'code', 'ref', 'key']);
  const verb = r.pick([{ v: 'confirm', s: 'confirmed' }, { v: 'verify', s: 'verified' }, { v: 'accept', s: 'accepted' }, { v: 'activate', s: 'activated' }]);
  const u = mkUnit(X, r.pick(['Confirm', 'Verify', 'Callback', 'Landing']));
  const minLen = r.pick([1, 1, 8]);
  mkSettingsService(X, [verb.v + '(' + T + ': string): boolean {\n  this.prefs[' + T + '] = ' + sq(verb.s) + ';\n  return true;\n}']);
  u.dep('route', 'ActivatedRoute', 'ActivatedRoute'); u.dep('svc', X.svc); u.local(X.svcFile, X.svc);
  u.prop('state', 'string', "'pending'");
  const gate = minLen > 1 ? '!' + T + ' || ' + T + '.length < ' + minLen : '!' + T;
  const inner = 'if (' + gate + ') {\n  this.state = \'missing\';\n  return;\n}\nthis.state = this.svc.' + verb.v + '(' + T + ') ? ' + sq(verb.s) + " : 'invalid';";
  if (r.chance(0.5)) u.onInit('const ' + T + " = this.route.snapshot.queryParamMap.get('" + T + "');\n" + inner);
  else u.onInit("this.route.queryParamMap.subscribe((params) => {\n  const " + T + " = params.get('" + T + "');\n" + ind(inner) + '\n});');
  setTpl(X, u, human(E.s) + ' ' + verb.v, '<p>Status: {{ state }}</p>');
  const route = addRoute(X, u, verb.v + '-' + kebab(X.base));
  u.write();
  addTruth(X, { idiom: 'query-param-init', component: u.cls, handler: 'ngOnInit', routes: [route], inputSchema: { type: 'object', properties: { [T]: minLen > 1 ? { type: 'string', minLength: minLen } : { type: 'string', minLength: 1 } }, required: [T], additionalProperties: false }, validInput: { [T]: 'abcd1234efgh' }, effect: X.svc + '.' + verb.v + '(' + T + ') marks the ' + E.s + ' as ' + verb.s + ' using the ?' + T + ' query parameter on load', notes: 'Input is delivered as a query parameter, not a route path param.' });
}

// 14: paginator
function bPaginator(X) {
  const E = X.E;
  const u = baseRowUnit(X, r.pick(['Pager', 'Browser', 'Directory']));
  mkService(X, { seedCount: 25, methods: ['count(): number {\n  return this.items.length;\n}', 'loadPage(pageIndex: number, pageSize: number): ' + X.rec + '[] {\n  this.lastPage = pageIndex;\n  const start = pageIndex * pageSize;\n  return this.items.slice(start, start + pageSize);\n}'], extra: 'lastPage = 0;' });
  const sizes = r.pick([[5, 10, 25], [10, 25, 50], [5, 10, 20]]);
  u.mod('MatPaginatorModule'); u.need('PageEvent');
  u.prop('pageSizeOptions', 'number[]', arrLit(sizes)); u.prop('pageSize', 'number', String(sizes[0]));
  u.prop('total', 'number', 'this.svc.count()', true);
  u.prop('rows', X.rec + '[]', 'this.svc.loadPage(0, ' + sizes[0] + ')', true);
  const h = r.pick(['onPage', 'pageChanged', 'handlePage', 'onPageChange']);
  u.method(h, h + '(event: PageEvent): void {\n  this.pageSize = event.pageSize;\n  this.rows = this.svc.loadPage(event.pageIndex, event.pageSize);\n}');
  setTpl(X, u, human(E.p), '<ul>\n  @for (row of rows; track row.id) {\n    <li>{{ row.' + X.titleKey + ' }}</li>\n  }\n</ul>\n<mat-paginator [length]="total" [pageSize]="pageSize" [pageSizeOptions]="pageSizeOptions" (page)="' + h + '($event)"></mat-paginator>');
  const route = addRoute(X, u, kebab(u.cls.replace(/Component$/, '')));
  u.write();
  addTruth(X, { idiom: 'paginator', component: u.cls, handler: h, routes: [route], inputSchema: { type: 'object', properties: { pageIndex: { type: 'integer', minimum: 0 }, pageSize: { type: 'integer', enum: sizes } }, required: ['pageIndex', 'pageSize'], additionalProperties: false }, validInput: { pageIndex: 1, pageSize: sizes[0] }, effect: X.svc + '.loadPage(pageIndex, pageSize) loads a page of ' + E.p + ' and records the last page' });
}

// 15: tab group
function bTabs(X) {
  const E = X.E;
  const tabs = r.pick([['open', 'closed', 'all'], ['mine', 'team', 'archived', 'all'], ['active', 'inactive']]);
  const u = baseRowUnit(X, r.pick(['Tabs', 'Views', 'Workbench']));
  mkService(X, { methods: ['selectView(view: string): ' + X.rec + '[] {\n  this.view = view;\n  return view === \'all\' ? this.list() : this.items.filter((i) => i.status === view);\n}'], extra: "view = 'all';" });
  u.mod('MatTabsModule');
  u.prop('tabs', 'string[]', arrLit(tabs)); u.prop('index', 'number', '0');
  const h = r.pick(['onTabChange', 'tabChanged', 'selectTab', 'onIndexChange']);
  u.method(h, h + '(index: number): void {\n  this.index = index;\n  this.rows = this.svc.selectView(this.tabs[index]);\n}');
  setTpl(X, u, human(E.p), '<mat-tab-group [selectedIndex]="index" (selectedIndexChange)="' + h + '($event)">\n  @for (t of tabs; track t) {\n    <mat-tab [label]="t">\n      <p>{{ rows.length }} ' + E.p + ' in view {{ t }}</p>\n    </mat-tab>\n  }\n</mat-tab-group>');
  const route = addRoute(X, u, kebab(u.cls.replace(/Component$/, '')));
  u.write();
  addTruth(X, { idiom: 'tab-group', component: u.cls, handler: h, routes: [route], inputSchema: { type: 'object', properties: { index: { type: 'integer', minimum: 0, maximum: tabs.length - 1 } }, required: ['index'], additionalProperties: false }, validInput: { index: 1 }, effect: X.svc + '.selectView(view) stores the active ' + E.s + ' view and returns matching rows' });
}

// 16: mat-sort
function bSort(X) {
  const E = X.E;
  const u = baseRowUnit(X, r.pick(['Sortable', 'Ledger', 'Report']));
  const cols = [X.titleKey, 'status'];
  mkService(X, { methods: ['sortBy(active: string, direction: string): ' + X.rec + '[] {\n  this.sort = { active, direction };\n  const dir = direction === \'desc\' ? -1 : 1;\n  return [...this.items].sort((a, b) => String((a as any)[active]).localeCompare(String((b as any)[active])) * dir);\n}'], extra: "sort = { active: '', direction: '' };" });
  u.mod('MatTableModule', 'MatSortModule'); u.need('Sort');
  u.prop('columns', 'string[]', arrLit(cols));
  const h = r.pick(['onSort', 'sortData', 'announceSortChange', 'onSortChange']);
  u.method(h, h + '(sort: Sort): void {\n  this.rows = this.svc.sortBy(sort.active, sort.direction);\n}');
  const col = (n) => '<ng-container matColumnDef="' + n + '">\n  <th mat-header-cell *matHeaderCellDef mat-sort-header>' + human(n) + '</th>\n  <td mat-cell *matCellDef="let row">{{ row.' + n + ' }}</td>\n</ng-container>';
  setTpl(X, u, human(E.p), '<table mat-table matSort [dataSource]="rows" (matSortChange)="' + h + '($event)">\n' + ind(cols.map(col).join('\n') + '\n<tr mat-header-row *matHeaderRowDef="columns"></tr>\n<tr mat-row *matRowDef="let row; columns: columns"></tr>') + '\n</table>');
  const route = addRoute(X, u, kebab(u.cls.replace(/Component$/, '')));
  u.write();
  addTruth(X, { idiom: 'mat-sort', component: u.cls, handler: h, routes: [route], inputSchema: { type: 'object', properties: { active: { type: 'string', enum: cols }, direction: { type: 'string', enum: ['asc', 'desc', ''] } }, required: ['active', 'direction'], additionalProperties: false }, validInput: { active: cols[0], direction: 'asc' }, effect: X.svc + '.sortBy(active, direction) stores the sort order and returns sorted ' + E.p });
}

// 17/18 login & logout
function bLogin(X) {
  const E = X.E;
  const u = mkUnit(X, r.pick(['Login', 'SignIn', 'Access']));
  const uname = r.pick(['username', 'userName', 'login']);
  mkSettingsService(X, ['login(' + uname + ': string, password: string): boolean {\n  this.prefs[\'session\'] = { user: ' + uname + ', token: \'tok-\' + password.length };\n  return true;\n}', 'logout(): void {\n  delete this.prefs[\'session\'];\n}', 'currentUser(): string {\n  const s = this.prefs[\'session\'] as { user: string } | undefined;\n  return s ? s.user : \'\';\n}']);
  u.dep('auth', X.svc); u.dep('router', 'Router', 'Router'); u.local(X.svcFile, X.svc);
  const h = r.pick(['login', 'signIn', 'onLogin', 'submit']);
  const uMax = r.pick([32, 50, 64]), pMin = r.pick([6, 8, 10]);
  const fields = [{ name: uname, kind: 'text', required: true, minLength: 3, maxLength: uMax }, { name: 'password', kind: 'text', required: true, minLength: pMin, maxLength: 64 }];
  const reactive = r.chance(0.6);
  let content;
  if (reactive) {
    u.mod('ReactiveFormsModule'); u.need('Validators', 'FormBuilder'); u.dep('fb', 'FormBuilder');
    u.prop('form', 'FormGroup', 'this.fb.group({\n  ' + uname + ": ['', [Validators.required, Validators.minLength(3), Validators.maxLength(" + uMax + ")]],\n  password: ['', [Validators.required, Validators.minLength(" + pMin + '), Validators.maxLength(64)]]\n})', true);
    u.prop('error', 'string', "''");
    u.method(h, h + '(): void {\n  if (this.form.invalid) {\n    return;\n  }\n  const { ' + uname + ', password } = this.form.getRawValue();\n  if (this.auth.login(' + uname + ', password)) {\n    this.router.navigateByUrl(\'/\');\n  } else {\n    this.error = \'Invalid credentials\';\n  }\n}');
    content = '<form [formGroup]="form" (ngSubmit)="' + h + '()">\n  <label>Username <input formControlName="' + uname + '" autocomplete="username" /></label>\n  <label>Password <input type="password" formControlName="password" autocomplete="current-password" /></label>\n  <button type="submit">Sign in</button>\n  <p class="error">{{ error }}</p>\n</form>';
  } else {
    u.mod('FormsModule'); u.need('NgForm');
    u.prop(uname, 'string', "''"); u.prop('password', 'string', "''");
    u.method(h, h + '(form: NgForm): void {\n  if (form.invalid) {\n    return;\n  }\n  this.auth.login(this.' + uname + ', this.password);\n  this.router.navigateByUrl(\'/\');\n}');
    content = '<form #f="ngForm" (ngSubmit)="' + h + '(f)">\n  <label>Username <input name="' + uname + '" [(ngModel)]="' + uname + '" required minlength="3" maxlength="' + uMax + '" /></label>\n  <label>Password <input type="password" name="password" [(ngModel)]="password" required minlength="' + pMin + '" maxlength="64" /></label>\n  <button type="submit">Sign in</button>\n</form>';
  }
  setTpl(X, u, 'Sign in', content);
  const route = addRoute(X, u, kebab(u.cls.replace(/Component$/, '')));
  u.write();
  addTruth(X, { idiom: 'login-form', component: u.cls, handler: h, routes: [route], inputSchema: schemaOf(fields), validInput: { [uname]: 'alice', password: 'correcthorse' }, effect: X.svc + '.login(' + uname + ', password) stores a session, then navigates to /' });
}
function bLogout(X) {
  const u = mkUnit(X, r.pick(['Shell', 'Header', 'AccountHome']));
  mkSettingsService(X, ['logout(): void {\n  delete this.prefs[\'session\'];\n}', 'currentUser(): string {\n  const s = this.prefs[\'session\'] as { user: string } | undefined;\n  return s ? s.user : \'guest\';\n}']);
  u.dep('auth', X.svc); u.dep('router', 'Router', 'Router'); u.local(X.svcFile, X.svc);
  u.prop('user', 'string', 'this.auth.currentUser()', true);
  const h = r.pick(['logout', 'signOut', 'onLogout']);
  u.method(h, h + '(): void {\n  this.auth.logout();\n  this.router.navigate([\'/\']);\n}');
  setTpl(X, u, 'Account', '<header class="toolbar">\n  <span>Signed in as {{ user }}</span>\n  <button type="button" (click)="' + h + '()">Sign out</button>\n</header>');
  const route = addRoute(X, u, kebab(u.cls.replace(/Component$/, '')));
  u.write();
  addTruth(X, { idiom: 'logout-button', component: u.cls, handler: h, routes: [route], inputSchema: emptySchema(), validInput: {}, effect: X.svc + '.logout() clears the session, then navigates to /' });
}

// 19: conditional validator by route param (add vs edit)
function bConditional(X) {
  const E = X.E;
  const u = mkUnit(X, r.pick(['Account', 'Setup', 'Editor']));
  const fields = genFields(E, r.int(2, 4));
  const cf = r.pick(['accessCode', 'setupPin', 'initialPassword']);
  mkService(X, { fields, methods: [M.create(X, fields), M.update(X)] });
  const cfield = { name: cf, kind: 'text', required: false, minLength: 6, maxLength: 40 };
  files.set('services/' + kebab(X.svc) + '.service.ts', files.get('services/' + kebab(X.svc) + '.service.ts').replace('\n}\n', '\n}\n').replace(X.input + ' {\n', X.input + ' {\n  ' + cf + '?: string;\n'));
  u.mod('ReactiveFormsModule'); u.need('Validators', 'FormBuilder');
  u.dep('fb', 'FormBuilder'); u.dep('route', 'ActivatedRoute', 'ActivatedRoute'); u.dep('svc', X.svc); u.local(X.svcFile, X.svc, X.input);
  optionDecls(u, fields);
  u.prop('form', 'FormGroup', 'this.fb.group({\n  ' + rfControls(fields).concat([cf + ": ['', [Validators.minLength(6), Validators.maxLength(40)]]"]).join(',\n  ') + '\n})', true);
  u.prop('id', 'string', "''"); u.prop('isNew', 'boolean', 'false');
  u.onInit("this.id = this.route.snapshot.paramMap.get('id') ?? '';\nthis.isNew = this.id === 'new';\nconst ctrl = this.form.get('" + cf + "');\nif (this.isNew) {\n  ctrl?.addValidators(Validators.required);\n} else {\n  const existing = this.svc.find(this.id);\n  if (existing) {\n    this.form.patchValue(existing);\n  }\n}\nctrl?.updateValueAndValidity();");
  const h = r.pick(['save', 'submit', 'onSubmit']);
  u.method(h, h + '(): void {\n  if (this.form.invalid) {\n    this.form.markAllAsTouched();\n    return;\n  }\n  const value = this.form.getRawValue() as ' + X.input + ';\n  if (this.isNew) {\n    this.svc.create(value);\n  } else {\n    this.svc.update(this.id, value);\n  }\n}');
  const all = [...fields, cfield];
  const content = '<form [formGroup]="form" (ngSubmit)="' + h + '()">\n' + ind(fields.map((f) => rfField(X, u, f, false)).join('\n')) + '\n  <label>' + human(cf) + (X.legacy ? '' : ' @if (isNew) { (required) }') + '\n    <input type="password" formControlName="' + cf + '" />\n  </label>\n  <button type="submit">{{ isNew ? \'Create\' : \'Update\' }}</button>\n</form>';
  setTpl(X, u, human(E.s) + ' account', content);
  const route = addRoute(X, u, kebab(u.cls.replace(/Component$/, '')) + '/:id');
  u.write();
  addTruth(X, { idiom: 'conditional-validator-route', component: u.cls, handler: h, routes: [route], inputSchema: schemaOf(all, { id: { type: 'string' } }, ['id']), validInput: validOf(all, { id: 'new', [cf]: 'secret-pass' }), effect: X.svc + '.create(value) when id is "new", otherwise ' + X.svc + '.update(id, value)', notes: cf + ' is required only when route param id === "new" (add mode); optional (but minLength 6) in edit mode.' });
}

// 20: shared form for /x/new and /x/:id/edit
function bSharedForm(X) {
  const E = X.E;
  const u = mkUnit(X, r.pick(['Form', 'Editor', 'Upsert']));
  const fields = genFields(E, r.int(3, 5));
  mkService(X, { fields, methods: [M.create(X, fields), M.update(X)] });
  u.mod('ReactiveFormsModule'); u.need('Validators', 'FormBuilder');
  u.dep('fb', 'FormBuilder'); u.dep('route', 'ActivatedRoute', 'ActivatedRoute'); u.dep('svc', X.svc); u.dep('router', 'Router', 'Router'); u.local(X.svcFile, X.svc, X.input);
  optionDecls(u, fields);
  u.prop('form', 'FormGroup', 'this.fb.group({\n  ' + rfControls(fields).join(',\n  ') + '\n})', true);
  u.prop('editingId', 'string | null', 'null');
  u.onInit("const id = this.route.snapshot.paramMap.get('id');\nif (id) {\n  this.editingId = id;\n  const existing = this.svc.find(id);\n  if (existing) {\n    this.form.patchValue(existing);\n  }\n}");
  const h = r.pick(['save', 'submit', 'onSubmit']);
  u.method(h, h + '(): void {\n  if (this.form.invalid) {\n    return;\n  }\n  const value = this.form.getRawValue() as ' + X.input + ';\n  if (this.editingId) {\n    this.svc.update(this.editingId, value);\n  } else {\n    this.svc.create(value);\n  }\n  this.router.navigate([\'/\']);\n}');
  setTpl(X, u, '{{ editingId ? \'Edit\' : \'New\' }} ' + E.s, '<form [formGroup]="form" (ngSubmit)="' + h + '()">\n' + ind(fields.map((f) => rfField(X, u, f, false)).join('\n')) + '\n  <button type="submit">Save</button>\n</form>');
  const base = kebab(X.base + 's');
  pages.push({ path: base + '/new', group: X.group, cls: u.cls, file: u.file, lazy: X.lazy });
  pages.push({ path: base + '/:id/edit', group: X.group, cls: u.cls, file: u.file, lazy: false });
  u.write();
  addTruth(X, { idiom: 'shared-form-new-edit', suffix: 'create', component: u.cls, handler: h, routes: [fullPath(X, base + '/new')], inputSchema: schemaOf(fields), validInput: validOf(fields), effect: X.svc + '.create(value) stores a new ' + E.s + ' (no id route param => create mode)' });
  addTruth(X, { idiom: 'shared-form-new-edit', suffix: 'update', component: u.cls, handler: h, routes: [fullPath(X, base + '/:id/edit')], inputSchema: schemaOf(fields, { id: { type: 'string' } }, ['id']), validInput: validOf(fields, { id: X.prefix + '-1' }), effect: X.svc + '.update(id, value) updates an existing ' + E.s + ' (id route param => edit mode)' });
}

// 21: stepper
function bStepper(X) {
  const E = X.E;
  const u = mkUnit(X, r.pick(['Stock', 'Counter', 'Quantity', 'Adjuster']));
  const m = r.pick(['adjust', 'changeQuantity', 'applyDelta']);
  mkSettingsService(X, [m + '(delta: number): number {\n  this.level += delta;\n  return this.level;\n}']);
  files.set('services/' + kebab(X.svc) + '.service.ts', files.get('services/' + kebab(X.svc) + '.service.ts').replace('  private prefs', '  private level = 10;\n  private prefs'));
  u.dep('svc', X.svc); u.local(X.svcFile, X.svc);
  u.prop('qty', 'number', '10');
  const variantB = r.chance(0.4);
  const route0 = () => addRoute(X, u, kebab(u.cls.replace(/Component$/, '')));
  if (!variantB) {
    const h = r.pick(['change', 'step', 'adjust', 'bump']);
    u.method(h, h + '(delta: number): void {\n  this.qty = this.svc.' + m + '(delta);\n}');
    setTpl(X, u, human(E.s) + ' quantity', '<button type="button" (click)="' + h + '(-1)">-</button>\n<span>{{ qty }}</span>\n<button type="button" (click)="' + h + '(1)">+</button>');
    const route = route0(); u.write();
    addTruth(X, { idiom: 'number-stepper', component: u.cls, handler: h, routes: [route], inputSchema: { type: 'object', properties: { delta: { type: 'integer', enum: [-1, 1] } }, required: ['delta'], additionalProperties: false }, validInput: { delta: 1 }, effect: X.svc + '.' + m + '(delta) changes the ' + E.s + ' quantity by delta' });
  } else {
    const hi = r.pick(['increment', 'increase', 'plus']), hd = r.pick(['decrement', 'decrease', 'minus']);
    u.method(hi, hi + '(): void {\n  this.apply(1);\n}'); u.method(hd, hd + '(): void {\n  this.apply(-1);\n}');
    u.method('apply', 'private apply(delta: number): void {\n  this.qty = this.svc.' + m + '(delta);\n}');
    setTpl(X, u, human(E.s) + ' quantity', '<button type="button" (click)="' + hd + '()">-</button>\n<span>{{ qty }}</span>\n<button type="button" (click)="' + hi + '()">+</button>');
    const route = route0(); u.write();
    addTruth(X, { idiom: 'number-stepper', suffix: 'inc', component: u.cls, handler: hi, routes: [route], inputSchema: emptySchema(), validInput: {}, effect: X.svc + '.' + m + '(+1) increases the ' + E.s + ' quantity by one' });
    addTruth(X, { idiom: 'number-stepper', suffix: 'dec', component: u.cls, handler: hd, routes: [route], inputSchema: emptySchema(), validInput: {}, effect: X.svc + '.' + m + '(-1) decreases the ' + E.s + ' quantity by one' });
  }
}

// 22: signals
function bSignal(X) {
  const E = X.E;
  const u = mkUnit(X, r.pick(['Signals', 'Queue', 'Tracker']));
  u.dep('svc', X.svc); u.need('signal', 'computed');
  if (r.chance(0.5)) {
    const act = r.pick(ROWACTS.filter((a) => a.status));
    mkService(X, { methods: [M.status(act.v, act.status)] });
    u.local(X.svcFile, X.svc, X.rec);
    u.prop('rows', null, 'signal<' + X.rec + '[]>(this.svc.list())', true);
    u.prop('openCount', null, "computed(() => this.rows().filter((r) => r.status === 'open').length)", true);
    const h = r.pick([act.v, 'on' + cap(act.v), act.v + cap(E.s)]);
    u.method(h, h + '(id: string): void {\n  this.svc.' + act.v + '(id);\n  this.rows.set(this.svc.list());\n}');
    setTpl(X, u, human(E.p) + ' ({{ openCount() }} open)', '<ul>\n  @for (row of rows(); track row.id) {\n    <li>\n      {{ row.' + X.titleKey + ' }} - {{ row.status }}\n      <button type="button" (click)="' + h + '(row.id)">' + act.label + '</button>\n    </li>\n  }\n</ul>');
    const route = addRoute(X, u, kebab(u.cls.replace(/Component$/, ''))); u.write();
    const p = X.E.s + 'Id';
    addTruth(X, { idiom: 'signal-component', component: u.cls, handler: h, routes: [route], inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false }, validInput: { id: X.prefix + '-1' }, effect: X.svc + '.' + act.v + '(id) sets the ' + E.s + ' status to ' + act.status + ' and refreshes the rows signal' });
  } else {
    mkService(X, { methods: ['add(' + X.titleKey + ': string): ' + X.rec + ' {\n  const rec: ' + X.rec + " = { id: '" + X.prefix + "-' + this.seq++, " + X.titleKey + ", status: 'open' };\n  this.items = [...this.items, rec];\n  return rec;\n}"] });
    u.local(X.svcFile, X.svc, X.rec);
    u.prop('draft', null, "signal('')"); u.prop('rows', null, 'signal<' + X.rec + '[]>(this.svc.list())', true);
    u.prop('canAdd', null, 'computed(() => this.draft().trim().length >= 3)');
    const h = r.pick(['add', 'addItem', 'quickAdd']);
    u.method(h, h + '(): void {\n  const value = this.draft().trim();\n  if (value.length < 3 || value.length > 60) {\n    return;\n  }\n  this.svc.add(value);\n  this.rows.set(this.svc.list());\n  this.draft.set(\'\');\n}');
    setTpl(X, u, human(E.p), '<input [value]="draft()" (input)="draft.set($any($event.target).value)" />\n<button type="button" [disabled]="!canAdd()" (click)="' + h + '()">Add</button>\n<ul>\n  @for (row of rows(); track row.id) {\n    <li>{{ row.' + X.titleKey + ' }}</li>\n  }\n</ul>');
    const route = addRoute(X, u, kebab(u.cls.replace(/Component$/, ''))); u.write();
    addTruth(X, { idiom: 'signal-component', component: u.cls, handler: h, routes: [route], inputSchema: { type: 'object', properties: { [X.titleKey]: { type: 'string', minLength: 3, maxLength: 60 } }, required: [X.titleKey], additionalProperties: false }, validInput: { [X.titleKey]: 'Northwind Trading' }, effect: X.svc + '.add(' + X.titleKey + ') stores a new ' + E.s + ' and updates the rows signal', notes: 'Handler reads the value from the draft signal (set by the input event); the logical input is the draft text.' });
  }
}

// 28: inline rename (template ref var)
function bRename(X) {
  const E = X.E;
  const u = baseRowUnit(X, r.pick(['Editor', 'Roster', 'Catalog']));
  mkService(X, { methods: ['rename(id: string, name: string): void {\n  this.items = this.items.map((i) => (i.id === id ? { ...i, ' + X.titleKey + ': name } : i));\n}'] });
  const h = r.pick(['rename', 'saveName', 'updateTitle']);
  u.method(h, h + '(id: string, name: string): void {\n  const trimmed = name.trim();\n  if (trimmed.length < 2 || trimmed.length > 40) {\n    return;\n  }\n  this.svc.rename(id, trimmed);\n  this.rows = this.svc.list();\n}');
  setTpl(X, u, human(E.p), '<ul>\n  @for (row of rows; track row.id) {\n    <li>\n      <input #nameBox [value]="row.' + X.titleKey + '" />\n      <button type="button" (click)="' + h + '(row.id, nameBox.value)">Rename</button>\n    </li>\n  }\n</ul>');
  const route = addRoute(X, u, kebab(u.cls.replace(/Component$/, ''))); u.write();
  addTruth(X, { idiom: 'inline-rename', component: u.cls, handler: h, routes: [route], inputSchema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string', minLength: 2, maxLength: 40 } }, required: ['id', 'name'], additionalProperties: false }, validInput: { id: X.prefix + '-1', name: 'Renamed ' + E.s }, effect: X.svc + '.rename(id, name) renames the ' + E.s });
}

// 29: bulk action button
function bBulk(X) {
  const E = X.E;
  const u = baseRowUnit(X, r.pick(['Cleanup', 'Admin', 'Maintenance']));
  const m = r.pick(['clearClosed', 'purgeArchived', 'removeCompleted']);
  mkService(X, { methods: [m + "(): number {\n  const before = this.items.length;\n  this.items = this.items.filter((i) => i.status === 'open');\n  return before - this.items.length;\n}"] });
  const h = r.pick(['clearAll', 'cleanUp', 'purge']);
  u.prop('removed', 'number', '0');
  u.method(h, h + '(): void {\n  this.removed = this.svc.' + m + '();\n  this.rows = this.svc.list();\n}');
  setTpl(X, u, human(E.p), '<p>{{ rows.length }} ' + E.p + ', last cleanup removed {{ removed }}</p>\n<button type="button" (click)="' + h + '()">Clean up</button>');
  const route = addRoute(X, u, kebab(u.cls.replace(/Component$/, ''))); u.write();
  addTruth(X, { idiom: 'bulk-action', component: u.cls, handler: h, routes: [route], inputSchema: emptySchema(), validInput: {}, effect: X.svc + '.' + m + '() removes every non-open ' + E.s });
}

// ---------- idiom table ----------
const IDIOMS = [
  ['reactive-form', (X) => bReactive(X, { idiom: 'reactive-form' })],
  ['template-form-ngmodel', bTdForm],
  ['template-fields-click', bTdClick],
  ['list-row-action-ngfor', (X) => { X.legacy = true; bRowList(X, 'ngfor'); }],
  ['list-row-action-at-for', (X) => bRowList(X, 'for')],
  ['mat-table-row-action', bMatTable],
  ['detail-route-action', bDetail],
  ['select-setting', (X) => bChoice(X, 'select')],
  ['toggle-setting', bToggle],
  ['search-input', bSearch],
  ['dialog-form', bDialog],
  ['child-output-parent-handler', bChildOutput],
  ['query-param-init', bQueryParam],
  ['paginator', bPaginator],
  ['tab-group', bTabs],
  ['mat-sort', bSort],
  ['button-toggle-setting', (X) => bChoice(X, 'toggle')],
  ['login-form', bLogin],
  ['logout-button', bLogout],
  ['conditional-validator-route', bConditional],
  ['shared-form-new-edit', bSharedForm],
  ['number-stepper', bStepper],
  ['signal-component', bSignal],
  ['reactive-mat-select-checkbox', (X) => bReactive(X, { idiom: 'reactive-mat-select-checkbox', mat: true, forceEnum: true, forceBool: true })],
  ['nested-control-flow', (X) => bRowList(X, 'nested')],
  ['radio-setting', (X) => bChoice(X, 'radio')],
  ['confirm-delete', (X) => bRowList(X, 'confirm')],
  ['inline-rename', bRename],
  ['bulk-action', bBulk],
];

// ---------- main ----------
const order = r.shuffle(IDIOMS);
for (let i = 0; i < count; i++) {
  const [key, fn] = order[i % order.length];
  const X = makeX(key);
  fn(X);
}
// guarantee a handful of decoys
if (decoys.length < 4) {
  for (let i = 0; i < 4 - decoys.length + 2; i++) {
    const X = makeX('decoy-page');
    const u = mkUnit(X, 'Help');
    u.dep('router', 'Router', 'Router');
    u.prop('showTips', 'boolean', 'false');
    u.method('toggleTips', 'toggleTips(): void {\n  this.showTips = !this.showTips;\n}');
    u.method('openHome', "openHome(): void {\n  this.router.navigate(['/']);\n}");
    u.method('logView', "logView(): void {\n  console.log('help viewed');\n}");
    setTpl(X, u, 'Help', '<button type="button" (click)="toggleTips()">Tips</button>\n<button type="button" (click)="openHome()">Home</button>\n<button type="button" (click)="logView()">Log</button>\n@if (showTips) {\n  <p>Tips go here.</p>\n}');
    addRoute(X, u, kebab(u.cls.replace(/Component$/, ''))); u.write();
    decoys.push({ component: u.cls, handler: 'toggleTips', why: 'display-only boolean toggle' }, { component: u.cls, handler: 'openHome', why: 'pure navigation' }, { component: u.cls, handler: 'logView', why: 'console logging only' });
  }
}

// routes file
function routeEntry(p, lazy) {
  const pathPart = sq(p.path);
  if (p.lazy) return "{ path: " + pathPart + ", loadComponent: () => import('./components/" + p.file + "').then((m) => m." + p.cls + ') }';
  return '{ path: ' + pathPart + ', component: ' + p.cls + ' }';
}
const eager = new Map();
for (const p of pages) if (!p.lazy) eager.set(p.cls, p.file);
let routesSrc = "import { Routes } from '@angular/router';\n";
for (const [cls, file] of eager) routesSrc += 'import { ' + cls + " } from './components/" + file + "';\n";
const topLevel = [], groups = new Map();
for (const p of pages) {
  if (p.group) { if (!groups.has(p.group)) groups.set(p.group, []); groups.get(p.group).push(p); } else topLevel.push(p);
}
const first = pages.find((p) => !p.group && !p.path.includes(':'));
const entries = [];
if (first) entries.push("{ path: '', redirectTo: " + sq(first.path) + ", pathMatch: 'full' }");
for (const p of topLevel) entries.push(routeEntry(p));
for (const [g, ps] of groups) entries.push('{\n    path: ' + sq(g) + ',\n    children: [\n' + ps.map((p) => '      ' + routeEntry(p)).join(',\n') + ',\n    ],\n  }');
routesSrc += '\nexport const routes: Routes = [\n' + entries.map((e) => '  ' + e).join(',\n') + ',\n];\n';
files.set('injected.routes.ts', routesSrc);

// README
files.set('README.md', `# Seeded Angular operation benchmark

\`node generate.mjs <outDir> <seed> <count>\` writes components/, services/, injected.routes.ts, truth.json, decoys.json.

truth.json: array of operations the UI exposes.
{ id, idiom, component (class), handler (component method the UI event invokes), routes (full router paths incl. :params, query-param ops are marked in notes),
  inputSchema (JSON Schema, additionalProperties:false; validators/options exactly as enforced by the code),
  validInput, effect, notes? }
Route params and repeated-row ids are required string properties. Count N = number of idiom builders run; some builders emit 2 operations
(shared-form-new-edit create+update; number-stepper with separate +/- handlers).

decoys.json: array of { component, handler, why } for handlers that are NOT business operations (navigation, display-only toggles, logging,
window.open/print, dialog open/close). Ambiguous: child-component send() (emits only; the persisting op is the parent handler) is not listed in either file.
`);

// write out
fs.rmSync(outDir, { recursive: true, force: true });
for (const [rel, content] of files) {
  const full = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}
fs.writeFileSync(path.join(outDir, 'truth.json'), JSON.stringify(truth, null, 2));
fs.writeFileSync(path.join(outDir, 'decoys.json'), JSON.stringify(decoys, null, 2));
console.log('wrote ' + truth.length + ' operations, ' + decoys.length + ' decoys, ' + pages.length + ' routes to ' + outDir);

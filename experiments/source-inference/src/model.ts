export type Schema = boolean | { [key: string]: unknown };

export interface SourceRef {
  file: string;
  line: number;
}

export interface Diagnostic {
  code: string;
  message: string;
  source?: SourceRef;
}

/** Known-widget bindings that a capability drives instead of (or besides) a form. */
export interface DriveBinding {
  /** Angular CDK drop event driven by DOM drag events. The source list is bound context, never an arbitrary first match. */
  drag?: {mode:'reorder'|'transfer';listSelector:string;itemSelector:string;sourceId?:string;sourceContext?:string;targetParam?:string;previousIndex:string;currentIndex:string;orientation:'vertical'|'horizontal';handleSelector?:string;itemAttribute?:string;startDelayMs?:number};
  counter?: CounterBinding;
  /** Literal arguments represented by distinct authored buttons, e.g. decrement/increment. */
  buttons?: { param: string; choices: { value: string | number | boolean; selector: string; matchText?: string | string[] }[] };
  paginator?: { selector: string; page?: string; pageSize?: string; sizes: number[] };
  sort?: { selector: string; param: string; /** Event also carries the column: `active` plus these column names. */ columnParam?: string; columns?: string[] };
  tabs?: { selector: string; param: string };
  search?: { selector: string; param: string };
  file?: { selector: string; param: string };
}

export interface CounterBinding {
  param:string;path?:string[];selector?:string;increment:UiLocator;decrement:UiLocator;valueSelector:string;submitAction?:boolean;
}

export interface Capability {
  id: string;
  fingerprint: string;
  route: string;
  /** Proven child-route patterns on which this layout's own action remains mounted. */
  allowedRoutes?:string[];
  routeParams?: string[];
  /** Query parameters a page-load action reads (e.g. a signed verification link token). */
  queryParams?: string[];
  /** Present on every route (the application shell): no route is navigated to or required. */
  global?: boolean;
  drive?: DriveBinding;
  /** Host-bound UI context, validated separately from tool arguments (for example the selected drag source column). */
  contextSchema?: Schema;
  /** What the running application did when the capability was executed in a sandbox (see probe.ts). */
  observed?: { effectClass: 'write' | 'read' | 'navigation' | 'opens-overlay' | 'ui-state' | 'none-observed'; http: { method: string; path: string; bodyKeys: string[] }[]; storage: string[]; calls?: { method: string; args: unknown }[]; confirmationRequired: boolean; agreement: number | null };
  /** `backend`: reaches a service, HttpClient or store dispatch. `ui-state`: only changes component/UI state (reviewed separately). */
  effectKind?: 'backend' | 'ui-state';
  /** The action lives in an overlay (for example a Material menu) that its trigger must open first. */
  reveal?: { trigger: string; panel: string; /** Host selector of the component that owns the trigger. */ owner?: string; matchText?: string | string[]; /** The trigger sits in a repeated row; this selects it. */ target?: Capability['target']; kind?: 'menu' | 'dialog' | 'inline'; event?:'dblclick' };
  /** Selects one of several repeated/hosted action instances by the data identity it acts on (needs Angular debug APIs at run time). */
  target?: { param: string; source: 'context' | 'component'; path: string[]; integer?: boolean; minimum?: number; literalValue?:string|number; /** A typed object can identify an existing row without being a set of editable controls. */ valuePath?:string[]; inputSchema?:Schema; /** Only source-proven signal input properties may be read as functions. */ signals?:string[]; keepInput?:boolean; /** Source-proven option text when Angular omits a projected row's loop context. */ projected?:{owner:string;collection:string[];labelPath:string[];/** Authored child row host when the action has no own text. */rowSelector?:string;/** Exact source-bound child input item, including while its edit view hides the label. */rowInputPath?:string[]} };
  component: string;
  componentSelector: string;
  action: { /** Host selector of the component whose template contains the element; the runtime refuses look-alike elements owned by other components. */ owner?: string; /** Static visible text that tells apart same-selector controls with different handlers. */ matchText?: string | string[]; allowDuplicates?: boolean; kind: 'form' | 'button' | 'workflow' | 'navigation'; selector: string; submitSelector?: string; label: string; event: string; expression: string; source: SourceRef };
  plan?: WorkflowPlan;
  fields: Field[];
  handler: string;
  callPath: string[];
  bindings: {
    token: string;
    service: string;
    method: string;
    source: SourceRef;
    arguments: string[];
    inputSchema: Schema;
    outputSchema: Schema;
    schemaIssues: string[];
    /** Parameter name -> property key it is sent under in an object literal inside the service method. */
    paramKeys?: Record<string, string>;
  }[];
  inputSchema: Schema;
  outputSchema: Schema;
  guards: string[];
  workflow: { confirmation: 'observed' | 'not-observed'; requiresConfirmation?:boolean; evidence: string[] };
  issues: string[];
  status: 'candidate' | 'blocked';
}

export interface Field {
  name: string;
  /** Authored form-control identifier, when a transport field uses a traced domain name instead. */
  sourceName?:string;
  selector: string;
  element: string;
  type: string;
  required: boolean;
  supported: boolean;
  schema: Schema;
  adapter?: 'native' | 'material-select' | 'material-checkbox' | 'material-toggle' | 'material-choice' | 'datepicker' | 'contenteditable' | 'aria-select';
  /** The option list is produced at run time; `refineManifest` can read it from the live application. */
  dynamicOptions?: boolean;
  label?: string;
  options?: { value: string; label: string }[];
  /** Seen at run time: the application only accepts this field when it equals the named one (a repeated password). */
  sameAs?: string;
}

export interface UiLocator { selector: string; label?: string; }
export interface RepeatBinding {
  name: string;
  rowSelector: string;
  fields: Field[];
  add: UiLocator;
  remove?: UiLocator;
  maxItems: number;
}
export interface WorkflowPlan {
  mode: 'submit' | 'edit';
  root: string;
  /** Fill controls in the closest authored row/container of the already selected action, then click that action. */
  targetRoot?: string;
  submit?: UiLocator;
  /** A source-authored keyboard/blur commit on the filled control. */
  commit?: {event:'keyup';key:'Enter'}|{event:'blur'};
  repeats: RepeatBinding[];
  /** Tag-style string lists entered one item at a time (text control committed with Enter). */
  lists?: { name: string; input: UiLocator; commit: 'enter'; minLength: number; unique: boolean }[];
  effect?: { kind: 'local-storage'; key: string; source: SourceRef };
}

export interface Manifest {
  formatVersion: 1;
  compilerVersion: '0.1.0';
  sourceDigest: string;
  routes: { path: string; component: string; guards: string[] }[];
  capabilities: Capability[];
  diagnostics: Diagnostic[];
}

export interface Approval {
  id: string;
  fingerprint: string;
  description: string;
  effect: 'read' | 'write';
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Schema;
  outputSchema: Schema;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: boolean };
}

// Certification: instead of trusting static analysis on an unseen project, every capability is executed against the
// project's own running dev build in a sandbox. Only capabilities whose effect was observed are proposed for approval,
// and a contract that disagrees with the app is repaired from the app's behaviour and probed again until it agrees.
// An action that cannot run on a freshly opened page (it needs a signed-in visitor, or a record to act on) is tried again
// in the state other certified actions leave behind: the app is brought there by its own actions, never by fixtures.
import type { Browser } from 'playwright';
import { reviewedTools, toolName } from './approval.js';
import { applyProbes, opens, probeCapability, settle, type ProbeOptions, type ProbeReport, type Step } from './probe.js';
import type { Approval, Capability, Manifest } from './model.js';

/** proven: effect observed and the contract agreed with the app on every probe. executed: effect observed, contract not fully checked. */
export type Verdict = 'proven' | 'executed' | 'unverified' | 'blocked';
export interface CertificationEntry {
  id: string; route: string; component: string; handler: string; verdict: Verdict; rounds: number;
  effectClass?: ProbeReport['effectClass']; agreement?: number | null; reason?: string; repaired: string[];
  /** The actions that were run first, in order: this one ran only in the state they left behind. */
  after?: string[];
}
/** What the sandbox let through while the actions ran: a reviewer reads the verdicts against it. */
export interface Conditions { liveReads: boolean; readOrigins: string[]; session: boolean; ownFiles?: string[] }
export interface Certification { manifest: Manifest; approvals: Approval[]; entries: CertificationEntry[]; conditions: Conditions }

type Need = NonNullable<ProbeReport['needs']>;
/** An action and the input the app accepted for it. The capability is looked up when the step runs: its contract may have been repaired since. */
interface Ref { id: string; args: Record<string, unknown> }
/**
 * A state of the app, named by the actions that lead to it. What they leave in browser storage is kept and every attempt
 * starts from it; what they leave only in the page's memory is run again before each attempt (`prelude`).
 */
interface World { key: string; steps: Ref[]; storage?: Awaited<ReturnType<typeof settle>>; prelude: Ref[] }

const label = (c: { component: string; handler: string; route: string }) => `${c.component}.${c.handler} on ${c.route}`;
const describe = (c: Capability, r: ProbeReport) => {
  const seen = [...r.effects.http.map(h => `${h.method} ${h.path}`), ...r.effects.storage.map(k => `storage ${k}`)].slice(0, 3).join(', ');
  return `${label(c)}. Observed in sandbox: ${r.effectClass}${seen ? ` (${seen})` : ''}.${r.confirmationRequired ? ' The app asks for confirmation.' : ''}`;
};

/** What each input is held to. An example or a description changes nothing a probe can check, so neither counts as a repair. */
const rulesOf = (c: Capability): Record<string, string> => Object.fromEntries(
  Object.entries((c.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}).map(([name, prop]) => {
    const { examples, description, ...rules } = (prop && typeof prop === 'object' ? prop : { schema: prop }) as Record<string, unknown>;
    return [name, JSON.stringify([rules, c.fields.find(field => field.name === name)?.sameAs ?? null])];
  }));

// Which certified action to try as the way into a state is a guess from names; the app decides whether the guess was right.
const AUTH = /log.?in|sign.?in|auth|regist|sign.?up|create.?account|account/i;
const JOINS = /regist|sign.?up|create|new|join/i;
const CREATES = /^(add|create|new|save|submit|insert|register|post|upload|import)/i;
const DESTROYS = /remove|delete|clear|reset|log.?out|sign.?out|destroy|cancel/i;
const STOP = new Set('add remove delete update edit toggle set get clear component store service form submit save new create list item from all page view button open close modal dialog app the and for with handle click change select'.split(' '));
const wordsOf = (c: Capability) => [...new Set(label(c).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).map(word => word.replace(/s$/, '')).filter(word => word.length > 2 && !STOP.has(word)))];
/** How likely one action is to leave what another needs: the same page, the same component, the same subject in their names. */
const affinity = (consumer: Capability, producer: Capability, need: Need, common: Set<string>) => {
  const mine = new Set(wordsOf(consumer)), shared = wordsOf(producer).filter(word => mine.has(word));
  return (producer.route === consumer.route ? 2 : 0) + (producer.component === consumer.component ? 1 : 0)
    // A word nearly every action carries (the app's own name) says little.
    + shared.filter(word => !common.has(word)).length * 2 + (shared.some(word => common.has(word)) ? 1 : 0)
    + (CREATES.test(producer.handler) || producer.action.kind === 'form' ? 1 : 0) - (DESTROYS.test(producer.handler) ? 3 : 0)
    + (AUTH.test(label(producer)) && (need === 'page' || need === 'control') ? 2 : 0);
};
const level = (need: Need) => need === 'page' ? 0 : need === 'effect' ? 2 : 1;

export async function certify(browser: Browser, source: Manifest, input: ProbeOptions & { rounds?: number; only?: (c: Capability) => boolean; explore?: number }): Promise<Certification> {
  // What one capability's probe learns about the running app (its links, whether its reads were stubbed) serves the next.
  const options: ProbeOptions = { ...input, shared: input.shared ?? {} };
  let manifest = source;
  const entries: CertificationEntry[] = [], approvals: Approval[] = [];
  const byId = (id: string) => manifest.capabilities.find(c => c.id === id)!;
  const ran = (entry: CertificationEntry) => entry.verdict === 'proven' || entry.verdict === 'executed';

  /** Probes one action, repairing its contract from the app until the two agree. */
  const probeRounds = async (entry: CertificationEntry, opts: ProbeOptions): Promise<ProbeReport | undefined> => {
    let report: ProbeReport | undefined;
    for (let round = 0; round < (input.rounds ?? 3); round++) {
      const current = byId(entry.id);
      try { report = await probeCapability(browser, manifest, current, opts); }
      catch (error) { entry.reason = `probe failed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`; return undefined; }
      entry.rounds++;
      if (report.skipped) break;
      const before = rulesOf(report.synthesized ?? current);
      manifest = applyProbes(manifest, [report]);
      const after = rulesOf(byId(entry.id));
      const changed = Object.keys(after).filter(name => after[name] !== before[name]).concat(report.synthesized ? ['inputs'] : []);
      for (const name of changed) if (!entry.repaired.includes(name)) entry.repaired.push(name);
      // Agreement is measured against the contract the probe started with; a repaired contract has to be probed again.
      if (report.agreement === 1 || report.agreement === null || !changed.length) break;
    }
    return report;
  };
  /** What the sandbox passed in the host's place when an action ran; it is passed again when the action is a step toward another. */
  const contexts = new Map<string, Record<string, unknown>>();
  /** Records what a probe showed; an action whose effect was observed is proposed for approval. */
  const conclude = (entry: CertificationEntry, report: ProbeReport, world?: World): boolean => {
    entry.effectClass = report.effectClass; entry.agreement = report.agreement;
    if (report.skipped) { entry.reason = report.skipped; return false; }
    if (report.effectClass === 'none-observed') { entry.reason = 'executing it produced no observable effect'; return false; }
    const capability = byId(entry.id);
    const hasInputs = Object.keys((capability.inputSchema as { properties?: object }).properties ?? {}).length > 0;
    entry.verdict = report.agreement === 1 || (report.agreement === null && !hasInputs) ? 'proven' : 'executed';
    entry.reason = entry.verdict === 'proven' ? undefined : report.agreement === null ? 'ran with example inputs; constraints could not be checked' : `contract still disagrees with the app on ${Math.round((1 - report.agreement) * 100)}% of probes: ${report.disagreements[0] ?? ''}`;
    // Rules no schema can state are named, so a reviewer knows the tool refuses more than its schema says.
    const beyond = Object.entries(report.sameAs ?? {}).map(([dependent, source]) => `${dependent} must equal ${source}`);
    if (report.ownRules?.length) beyond.push(`the application also enforces its own rule (${report.ownRules.join(', ')}) when called`);
    // What the sandbox supplied in the host's place is named as well: a served tool takes it from its own host.
    const hosted = Object.entries(report.context ?? {}).filter(([name]) => name !== 'confirmedCapability').map(([name, value]) => `${name}=${JSON.stringify(value)}`);
    if (report.context) {
      contexts.set(entry.id, report.context);
      beyond.push(hosted.length ? `ran with host context ${hosted.join(', ')}; a served tool takes it from --context` : 'the sandbox confirmed it in the host\'s place; a served tool needs the host\'s confirmation (--context)');
    }
    if (beyond.length) entry.reason = [entry.reason, ...beyond].filter(Boolean).join('; ');
    if (world) entry.after = world.steps.map(step => label(byId(step.id)));
    // The description is what an agent reads: it has to say which actions put the app in the state this one ran in.
    // Their inputs are left out; one of them may be a password.
    const state = world ? ` It ran only in the state left by ${world.steps.map(step => `${toolName(byId(step.id))} (${label(byId(step.id))})`).join(', then ')}.` : '';
    const approval: Approval = { id: capability.id, fingerprint: capability.fingerprint, description: describe(capability, report) + (hosted.length ? ` It ran with host context ${hosted.join(', ')}.` : '') + state, effect: report.effectClass === 'read' ? 'read' : 'write' };
    // The approval rules decide whether `read` is defensible; anything else is offered as a write.
    try { reviewedTools(manifest, [approval]); } catch { approval.effect = 'write'; }
    approvals.push(approval);
    return true;
  };

  // First every action on a freshly opened page. What ran leaves an input the app accepted; what did not leaves what it lacked.
  const examples = new Map<string, Record<string, unknown>>(), needs = new Map<string, Need | undefined>(), madeIn = new Map<string, World>();
  for (const original of source.capabilities) {
    const entry: CertificationEntry = { id: original.id, route: original.route, component: original.component, handler: original.handler, verdict: 'unverified', rounds: 0, repaired: [] };
    entries.push(entry);
    if (original.status !== 'candidate') { entry.verdict = 'blocked'; entry.reason = original.issues[0] ?? 'blocked by static analysis'; continue; }
    if (input.only && !input.only(original)) { entry.reason = 'not selected'; continue; }
    const report = await probeRounds(entry, options);
    if (report && conclude(entry, report)) { if (report.example) examples.set(entry.id, report.example); }
    else needs.set(entry.id, report?.needs);
  }

  // Then what could not run is tried in the states the actions that did run leave behind.
  const explore = input.explore ?? 80;
  const pending = () => entries.filter(entry => needs.has(entry.id) && !ran(entry));
  const producers = () => entries.filter(entry => ran(entry) && entry.effectClass === 'write' && examples.has(entry.id));
  if (explore > 0 && pending().length && producers().length) {
    const worlds = new Map<string, World>();
    const resolve = (refs: Ref[]): Step[] => refs.map(ref => ({ capability: byId(ref.id), args: ref.args, context: contexts.get(ref.id) }));
    const under = (world?: World): ProbeOptions => world ? { ...options, storageState: world.storage ?? options.storageState, prelude: resolve(world.prelude), world: world.key } : options;
    /** A later step is given what an earlier one entered under the same name: the account that was registered is the one that signs in. */
    const carry = (refs: Ref[]): Ref[] => {
      const entered: Record<string, string> = {};
      return refs.map(ref => {
        const capability = byId(ref.id), args = { ...ref.args };
        const properties = (capability.inputSchema as { properties?: Record<string, { enum?: unknown; const?: unknown } | undefined> }).properties ?? {};
        for (const field of capability.fields) if (typeof args[field.name] === 'string' && entered[field.name] && !properties[field.name]?.enum && properties[field.name]?.const === undefined) args[field.name] = entered[field.name];
        for (const [name, value] of Object.entries(args)) if (typeof value === 'string' && value) entered[name] = value;
        return { id: ref.id, args };
      });
    };
    const extend = async (parent: World | undefined, ref: Ref): Promise<World> => {
      const steps = carry([...(parent?.steps ?? []), ref]), last = steps.at(-1)!;
      const key = steps.map(step => `${step.id} ${JSON.stringify(step.args)}`).join('\n');
      const known = worlds.get(key);
      if (known) return known;
      // State held in memory has to be built again before every attempt, and so does whatever is built on top of it.
      const storage = parent?.prelude.length ? undefined : await settle(browser, manifest, resolve([last]), under(parent)).catch(() => undefined);
      const world: World = { key, steps, storage: storage ?? parent?.storage, prelude: storage ? [] : [...(parent?.prelude ?? []), last] };
      worlds.set(key, world);
      return world;
    };
    const trail = (world: World) => world.steps.map(step => label(byId(step.id))).join(', then ');

    const tried = new Set<string>(), closed = new Set<string>(), starved = new Set<string>(), searched = new Set<string>();
    let spent = 0;
    const attempt = async (entry: CertificationEntry, world: World, lighter?: () => Promise<World>): Promise<'ran' | 'failed' | 'skipped'> => {
      const capability = byId(entry.id), pair = `${entry.id}\n\n${world.key}`, place = `${world.key}\n\n${capability.route}`, rows = `${place}\n\n${capability.component}`;
      // A page that stayed closed in this state, or a list that stayed empty, is not asked about again for the actions next to it.
      if (tried.has(pair) || spent >= explore || closed.has(place) || starved.has(rows)) return 'skipped';
      tried.add(pair); spent++;
      let quick: ProbeReport;
      try { quick = await probeCapability(browser, manifest, capability, { ...under(world), quick: true }); } catch { return 'failed'; }
      const was = needs.get(entry.id);
      let full = !quick.skipped && !!quick.example;
      if (!full) {
        if (quick.needs === 'page') closed.add(place);
        if (quick.needs === 'record') starved.add(rows);
        // The control is there now and the app refused the example input: a search for an input it accepts is worth one full probe.
        if (quick.needs === 'effect' && was && was !== 'effect' && capability.fields.length && !searched.has(entry.id)) { searched.add(entry.id); full = true; }
      }
      // The state may hold more than the action asks for (a signed-in visitor on a page anyone can open): where the
      // lighter state is enough, that is the one the action is certified in and the one its description names.
      if (full && lighter && spent < explore) {
        const light = await lighter();
        spent++;
        const again = await probeCapability(browser, manifest, capability, { ...under(light), quick: true }).catch(() => undefined);
        if (again && !again.skipped && again.example) world = light;
      }
      if (full) {
        const before = entry.reason, report = await probeRounds(entry, under(world));
        if (report && conclude(entry, report, world)) {
          if (report.example) examples.set(entry.id, report.example);
          madeIn.set(entry.id, world); needs.delete(entry.id);
          return 'ran';
        }
        entry.reason = `${entry.reason ?? before} (after ${trail(world)})`;
        if (report?.needs) needs.set(entry.id, report.needs);
        return 'failed';
      }
      // Getting further without running is worth telling: the reason names how far the app was brought.
      if (was && quick.needs && quick.skipped && level(quick.needs) > level(was)) { needs.set(entry.id, quick.needs); entry.reason = `${quick.skipped} (after ${trail(world)})`; }
      return 'failed';
    };

    // A page that stays closed usually wants a signed-in visitor. The app's own actions may sign one in: the first state
    // that opens such a page is the one everything else is tried in.
    const ref = (entry: CertificationEntry): Ref => ({ id: entry.id, args: examples.get(entry.id)! });
    let session: World | undefined;
    const shut = [...new Set(pending().filter(entry => needs.get(entry.id) === 'page').map(entry => byId(entry.id).route))];
    if (shut.length) {
      const fixed = shut.filter(route => !/[:*]/.test(route)), routes = (fixed.length ? fixed : shut.map(route => route.replace(/:\w+/g, '1'))).slice(0, 2);
      const all = producers(), auth = all.filter(entry => AUTH.test(label(entry)));
      const pairs = auth.flatMap(second => all.filter(first => first !== second).map(first => [first, second]))
        .sort((x, y) => Number(JOINS.test(label(y[0]))) - Number(JOINS.test(label(x[0]))));
      search: for (const steps of [...auth.map(entry => [entry]), ...pairs, ...all.filter(entry => !auth.includes(entry)).map(entry => [entry])].slice(0, 8)) {
        let world: World | undefined;
        for (const step of steps) world = await extend(world, ref(step));
        for (const route of routes) if (await opens(browser, manifest, route, under(world)).catch(() => false)) { session = world; break search; }
      }
      if (session) for (const entry of pending()) await attempt(entry, session);
    }

    // What is still missing is usually a record. The actions most likely to leave one (same page, same subject) are run
    // first; an action certified this way can in turn lead to the state another one needs.
    const frequency = new Map<string, number>();
    for (const capability of manifest.capabilities) for (const word of wordsOf(capability)) frequency.set(word, (frequency.get(word) ?? 0) + 1);
    const common = new Set([...frequency].filter(([, count]) => count * 2 > manifest.capabilities.length).map(([word]) => word));
    for (let pass = 0; pass < 3 && spent < explore; pass++) {
      let gained = 0;
      for (const entry of pending()) {
        const need = needs.get(entry.id);
        if (!need) continue;
        const consumer = byId(entry.id);
        const ranked = producers().map(producer => { const base = madeIn.get(producer.id) ?? session; return { producer, base, score: affinity(consumer, byId(producer.id), need, common), depth: base?.steps.length ?? 0 }; })
          .filter(candidate => candidate.score >= 2 && candidate.depth < 4 && !candidate.base?.steps.some(step => step.id === candidate.producer.id))
          .sort((a, b) => b.score - a.score || a.depth - b.depth);
        let left = need === 'effect' ? 2 : 3;
        for (const { producer, base } of ranked) {
          if (!left || spent >= explore) break;
          const outcome = await attempt(entry, await extend(base, ref(producer)), base && !madeIn.has(producer.id) ? () => extend(undefined, ref(producer)) : undefined);
          if (outcome === 'skipped') continue;
          left--;
          if (outcome === 'ran') { gained++; break; }
        }
      }
      if (!gained) break;
    }
  }

  const order = new Map(source.capabilities.map((capability, index) => [capability.id, index]));
  approvals.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return { manifest, approvals, entries, conditions: { liveReads: !!options.liveReads, readOrigins: options.readOrigins ?? [], session: !!options.storageState, ownFiles: [...(options.shared?.ownFiles ?? [])].sort() } };
}

export function certificationReport(c: Certification): string {
  const count = (v: Verdict) => c.entries.filter(e => e.verdict === v).length, total = c.entries.length;
  const note = (e: CertificationEntry) => [e.after?.length && (e.verdict === 'proven' || e.verdict === 'executed') ? `ran only after ${e.after.join(', then ')}` : '', e.reason ?? ''].filter(Boolean).join('; ');
  const rows = (v: Verdict) => c.entries.filter(e => e.verdict === v).map(e => `| ${e.route} | ${e.component}.${e.handler} | ${e.effectClass ?? '-'} | ${e.repaired.join(', ') || '-'} | ${note(e)} |`).join('\n');
  const own = c.conditions.ownFiles ?? [];
  const sandbox = (c.conditions.liveReads
    ? `Sandbox: read requests (GET, HEAD) reached the app's own origin and other local hosts${c.conditions.readOrigins.length ? `, and ${c.conditions.readOrigins.join(', ')}` : ''}; every other request was answered by the sandbox.`
    : own.length
      ? `Sandbox: the only requests that left the browser were reads (GET, HEAD) of the app's own files from its dev server (${own.slice(0, 12).join(', ')}${own.length > 12 ? ` and ${own.length - 12} more` : ''}); every other request was answered by the sandbox with an empty document.`
      : 'Sandbox: no request reached a backend; every one was answered by the sandbox with an empty document.') +
    (c.conditions.session ? ' Every attempt started from the saved browser session that was passed in.' : '');
  const staged = c.entries.filter(e => e.after?.length && (e.verdict === 'proven' || e.verdict === 'executed')).length;
  const section = (title: string, v: Verdict) => count(v) ? `\n## ${title} (${count(v)})\n\n| Route | Action | Observed | Repaired from the app | Note |\n|---|---|---|---|---|\n${rows(v)}\n` : '';
  return `# Certification\n\n${count('proven') + count('executed')} of ${total} discovered actions ran in the sandbox and are proposed for approval ` +
    `(${count('proven')} proven, ${count('executed')} executed); ${count('unverified')} unverified and ${count('blocked')} blocked are not offered as tools.\n\n` +
    `Proven: the action's effect was observed and its input contract agreed with the app on every probe. Executed: the effect was observed with example inputs, the constraints were not fully confirmed. ` +
    (staged ? `${staged} of the actions that ran did so only in the state another certified action left behind (a signed-in visitor, a record that had just been added); the note names that action, and so does the tool's description, so an agent knows to call it first. ` : '') +
    `Certification covers the actions the compiler discovered; it does not show that every action in the app was discovered. Review the proposed approvals before serving them.\n\n${sandbox}\n` +
    section('Proven', 'proven') + section('Executed', 'executed') + section('Unverified', 'unverified') + section('Blocked', 'blocked');
}

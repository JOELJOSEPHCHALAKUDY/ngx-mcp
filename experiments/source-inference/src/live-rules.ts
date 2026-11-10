import { EMAIL_PATTERN } from './email-pattern.js';
import type { LiveForm, LiveRules } from './live-forms.js';

type Prop = Record<string, any>;
const STANDARD = new Set(['required', 'minlength', 'maxlength', 'min', 'max', 'pattern', 'email']);
const CONFIRMS = /confirm|repeat|again|retype|verify|match/i;
const CANDIDATES = ['Aa1!aaaa', 'Abcdef1!', 'abc123', 'abc', 'ABC', '12345', '1', '5551234567', '+15551234567', 'https://example.test', '2026-01-15', '10:30', 'a-b_c', '#aabbcc', 'AB12 3CD'];

/** The JSON Schema pattern equal to what Angular reported, or undefined when a schema cannot carry it. */
export function schemaPattern(reported: string): string | undefined {
  // Angular reports a string pattern anchored (`^...$`) and a RegExp as its literal (`/.../flags`).
  const literal = /^\/(.*)\/([a-z]*)$/s.exec(reported);
  if (literal && /[^ud]/.test(literal[2])) return undefined;
  const source = literal ? literal[1] : reported;
  try { new RegExp(source, 'u'); return source; } catch { return undefined; }
}

function liveRegex(reported: string): RegExp | undefined {
  const literal = /^\/(.*)\/([a-z]*)$/s.exec(reported);
  try { return literal ? new RegExp(literal[1], literal[2].replace(/[gy]/g, '')) : new RegExp(reported); } catch { return undefined; }
}

const core = (pattern: string): string => pattern.replace(/^\^\(\?:(.*)\)\$$/s, '$1').replace(/^\^(.*)\$$/s, '$1');

/**
 * Constraints the application's validators enforce that the schema does not state yet. It only tightens: with the runtime
 * refusing values the form model rejects, a rule read from that model is part of the action's real contract.
 */
export function livePatch(prop: Prop | undefined, rules: LiveRules): { patch: Record<string, unknown>; notes: string[] } {
  const patch: Record<string, unknown> = {}, notes: string[] = [];
  if (rules.custom?.length) notes.push(`the application also applies its own rule (${rules.custom.join(', ')}) that the schema does not describe`);
  if (rules.async) notes.push('an asynchronous validator also applies; it was not exercised');
  if (!prop || typeof prop !== 'object' || 'enum' in prop || 'const' in prop || prop.anyOf || prop.oneOf || prop.allOf) return { patch, notes };
  if (prop.type === 'boolean') { if (rules.requiredTrue) patch.const = true; return { patch, notes }; }
  if (prop.type === 'integer' || prop.type === 'number') {
    if (typeof rules.min === 'number' && !(prop.minimum >= rules.min)) patch.minimum = prop.type === 'integer' ? Math.ceil(rules.min) : rules.min;
    if (typeof rules.max === 'number' && !(prop.maximum <= rules.max)) patch.maximum = prop.type === 'integer' ? Math.floor(rules.max) : rules.max;
    return { patch, notes };
  }
  if (prop.type !== 'string') return { patch, notes };
  if (typeof rules.maxLength === 'number' && !(prop.maxLength <= rules.maxLength)) patch.maxLength = rules.maxLength;
  const checks: string[] = rules.email ? [EMAIL_PATTERN] : [];
  for (const reported of rules.patterns ?? []) {
    const pattern = schemaPattern(reported);
    if (pattern === undefined) notes.push(`a format rule (${reported.slice(0, 60)}) cannot be written as a schema pattern`);
    else if (!checks.includes(pattern)) checks.push(pattern);
  }
  if (!rules.required) {
    // Angular's length and format validators pass an empty value: an optional field takes them only when it is not empty.
    const nonempty: Prop = { type: 'string' };
    if ((rules.minLength ?? 0) > 1) nonempty.minLength = rules.minLength;
    if (checks.length === 1) nonempty.pattern = checks[0]; else if (checks.length) nonempty.allOf = checks.map(pattern => ({ pattern }));
    if (Object.keys(nonempty).length > 1 && !prop.pattern && !prop.minLength) patch.anyOf = [{ const: '' }, nonempty];
    return { patch, notes };
  }
  const min = Math.max(1, rules.minLength ?? 1);
  if (!(prop.minLength >= min)) patch.minLength = min;
  const stated = typeof prop.pattern === 'string' ? [core(prop.pattern)] : [];
  const fresh = checks.filter(pattern => !stated.includes(core(pattern)));
  if (fresh.length === 1 && !stated.length) patch.pattern = fresh[0];
  else if (fresh.length) patch.allOf = fresh.map(pattern => ({ pattern }));
  return { patch, notes };
}

/**
 * A value the live rules accept, the current one when it already does, or undefined when no realistic candidate fits.
 * `avoid` lists values the application has already refused, which a rule of its own (a password strength check) can do
 * to a value that meets every rule read here.
 */
export function liveValue(prop: Prop | undefined, rules: LiveRules, current: unknown, avoid: unknown[] = []): unknown {
  if (!prop || typeof prop !== 'object' || 'enum' in prop || 'const' in prop) return undefined;
  if (prop.type === 'boolean') return rules.requiredTrue ? true : undefined;
  if (prop.type === 'integer' || prop.type === 'number') {
    let n = typeof current === 'number' ? current : 1;
    if (typeof rules.min === 'number') n = Math.max(n, prop.type === 'integer' ? Math.ceil(rules.min) : rules.min);
    if (typeof rules.max === 'number') n = Math.min(n, prop.type === 'integer' ? Math.floor(rules.max) : rules.max);
    return avoid.includes(n) ? undefined : n;
  }
  if (prop.type !== 'string') return undefined;
  const min = Math.max(rules.minLength ?? 1, 1), max = rules.maxLength ?? Infinity;
  const regexes = (rules.patterns ?? []).map(liveRegex).filter((r): r is RegExp => !!r);
  const fits = (v: string) => v.length >= min && v.length <= max && regexes.every(r => r.test(v)) && (!rules.email || /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v));
  const plain = 'a'.repeat(Math.min(Math.max(min, 3), max));
  const pool = [typeof current === 'string' ? current : '', ...(rules.email ? ['probe@example.test', 'a@b.co'] : []), plain, ...CANDIDATES, ...CANDIDATES.map(c => c.padEnd(min, 'a')), ...CANDIDATES.map(c => c.padEnd(min, '1'))];
  return pool.find(v => v && fits(v) && !avoid.includes(v));
}

function partner(name: string, strings: string[]): string | undefined {
  const lower = name.toLowerCase(), others = strings.filter(other => other !== name);
  const related = others.filter(other => lower.includes(other.toLowerCase())).sort((a, b) => b.length - a.length)[0];
  if (related) return related;
  if (!CONFIRMS.test(name)) return undefined;
  const index = strings.indexOf(name);
  return index > 0 ? strings[index - 1] : undefined;
}

/**
 * Choose new example values from what the form model reported about the rejected ones. A field whose only complaint is an
 * application-specific rule and whose name refers to another field (confirmPassword / password) is tried as a copy of it.
 * `refused` is the caller's record of values each field was already refused with; it grows with every call.
 */
export function repairFromLive(names: string[], properties: Record<string, Prop>, base: Record<string, unknown>, form: LiveForm, mirrors: Record<string, string>, refused: Record<string, unknown[]> = {}): { values: Record<string, unknown>; mirrors: Record<string, string> } {
  const values: Record<string, unknown> = {}, linked: Record<string, string> = {};
  const strings = names.filter(name => properties[name]?.type === 'string' && !properties[name].enum);
  const copy = (name: string): boolean => {
    const source = strings.includes(name) && !mirrors[name] ? partner(name, strings) : undefined;
    if (!source || mirrors[source] || base[source] === base[name]) return false;
    values[name] = base[source]; linked[name] = source; return true;
  };
  for (const field of form.fields) {
    if (!names.includes(field.name) || !field.errors.length) continue;
    if (field.errors.every(key => !STANDARD.has(key)) && copy(field.name)) continue;
    (refused[field.name] ??= []).push(base[field.name]);
    const next = liveValue(properties[field.name], field.rules, base[field.name], refused[field.name]);
    if (next !== undefined && next !== base[field.name]) values[field.name] = next;
  }
  // A rule reported on the form group rather than on a field: the usual case is two fields that must match.
  if (!Object.keys(values).length && form.group.some(key => !STANDARD.has(key))) strings.some(copy);
  // A copied field follows its source when that one changes in the same step.
  for (const [dependent, source] of Object.entries({ ...mirrors, ...linked })) if (source in values) values[dependent] = values[source];
  return { values, mirrors: linked };
}

import type { Page } from 'playwright';

/** What the application's own form model says about one control. */
export interface LiveRules { required?: boolean; requiredTrue?: boolean; email?: boolean; minLength?: number; maxLength?: number; min?: number; max?: number; patterns?: string[]; custom?: string[]; async?: boolean }
export interface LiveField { name: string; kind: 'reactive' | 'signal'; status?: string; updateOn?: string; errors: string[]; rules: LiveRules }
export interface LiveForm { fields: LiveField[]; group: string[]; invalid: boolean; unfilled: string[]; sideEffects?: boolean }

/**
 * Record the form model the runtime is about to submit. The runtime calls `__angularMcpBeforeDispatch` with the controls
 * behind the action's own fields. This reads their state and, when `trials` is set, asks each validator what it would say
 * about a few values. The validator is given a read-only view of its control, so the application's state is not changed.
 * The body is serialized into the page: helpers are object methods because named functions do not survive that.
 */
export async function watchForms(page: Page, trials: boolean): Promise<void> {
  await page.evaluate(withTrials => {
    const w = window as any;
    const known = ['required', 'minlength', 'maxlength', 'min', 'max', 'pattern', 'email'];
    const h = {
      trial(c: any, value: unknown): Record<string, any> | null {
        try { return c.validator ? c.validator(new Proxy(c, { get(t: any, k: any) { return k === 'value' ? value : Reflect.get(t, k); }, set() { return true; } })) : null; } catch { return null; }
      },
      reactive(c: any): Record<string, any> {
        const rules: Record<string, any> = {};
        if (c.asyncValidator) rules.async = true;
        // A control validated only on submit is not valid or invalid before dispatch, so nothing is derived from it.
        if (!withTrials || !c.validator || c.updateOn === 'submit') return rules;
        const empty = h.trial(c, ''), one = h.trial(c, 'a');
        if (one?.required && !h.trial(c, true)?.required) rules.requiredTrue = true; else if (empty?.required) rules.required = true;
        if (typeof one?.minlength?.requiredLength === 'number') rules.minLength = one.minlength.requiredLength;
        if (one?.email) rules.email = true;
        const long = h.trial(c, 'a'.repeat(10000)), low = h.trial(c, -1e15), high = h.trial(c, 1e15);
        if (typeof long?.maxlength?.requiredLength === 'number') rules.maxLength = long.maxlength.requiredLength;
        if (typeof low?.min?.min === 'number') rules.min = low.min.min;
        if (typeof high?.max?.max === 'number') rules.max = high.max.max;
        const patterns: string[] = [], custom: string[] = [];
        for (const result of [empty, one, long, low, high, h.trial(c, '!'), h.trial(c, ' x '), h.trial(c, '\u0001'), h.trial(c, '1'), h.trial(c, 'Aa1!')]) {
          if (!result || typeof result !== 'object') continue;
          const required = result.pattern?.requiredPattern;
          if (typeof required === 'string' && !patterns.includes(required)) patterns.push(required);
          for (const key of Object.keys(result)) if (!known.includes(key) && !custom.includes(key)) custom.push(key);
        }
        if (patterns.length) rules.patterns = patterns;
        if (custom.length) rules.custom = custom;
        return rules;
      },
      meta(s: any, key: string): unknown { try { return typeof s[key] === 'function' ? s[key]() : undefined; } catch { return undefined; } },
      signal(s: any): Record<string, any> {
        const rules: Record<string, any> = {};
        if (h.meta(s, 'required') === true) rules.required = true;
        for (const key of ['minLength', 'maxLength', 'min', 'max']) { const v = h.meta(s, key); if (typeof v === 'number') rules[key] = v; }
        const patterns = h.meta(s, 'pattern');
        if (Array.isArray(patterns) && patterns.length) rules.patterns = patterns.map(p => String(p));
        return rules;
      },
      walk(node: any, path: string, own: any[], out: string[]): void {
        const children = node?.controls;
        if (!children) { if (node?.status === 'INVALID' && !own.includes(node) && out.length < 8 && !out.includes(path || 'a control')) out.push(path || 'a control'); return; }
        for (const key of Object.keys(children)) h.walk(children[key], path ? `${path}.${key}` : key, own, out);
      },
      mark(c: any): string { return `${c.status}:${Object.keys(c.errors ?? {}).join(',')}`; },
    };
    w.__angularMcpBeforeDispatch = (own: { name: string; control?: any; state?: any }[]) => {
      const form: any = { fields: [], group: [], invalid: false, unfilled: [] };
      const controls = own.filter(o => o.control).map(o => o.control);
      const before = controls.map(c => h.mark(c));
      for (const item of own) {
        try {
          if (item.control) {
            const c = item.control, errors = Object.keys(c.errors ?? {}), rules = h.reactive(c);
            const custom = errors.filter(k => !known.includes(k) && !(rules.custom ?? []).includes(k));
            if (custom.length) rules.custom = [...(rules.custom ?? []), ...custom];
            form.fields.push({ name: item.name, kind: 'reactive', status: c.status, updateOn: c.updateOn, errors, rules });
            for (let p = c.parent; p; p = p.parent) for (const k of Object.keys(p.errors ?? {})) if (!form.group.includes(k)) form.group.push(k);
            if (c.root?.status === 'INVALID') { form.invalid = true; h.walk(c.root, '', controls, form.unfilled); }
          } else if (item.state) {
            const s = item.state, inactive = h.meta(s, 'hidden') === true || h.meta(s, 'disabled') === true || h.meta(s, 'readonly') === true;
            const kinds: string[] = inactive ? [] : ((h.meta(s, 'errors') as any[]) ?? []).map(e => String(e?.kind ?? 'invalid').toLowerCase());
            const rules = withTrials ? h.signal(s) : {};
            if (kinds.includes('email')) rules.email = true;
            const custom = kinds.filter(k => !known.includes(k));
            if (custom.length) rules.custom = custom;
            if (h.meta(s, 'pending') === true) rules.async = true;
            form.fields.push({ name: item.name, kind: 'signal', status: kinds.length ? 'INVALID' : h.meta(s, 'pending') === true ? 'PENDING' : 'VALID', errors: kinds, rules });
            let top = s;
            for (let p = s.structure?.parent; p; p = p.structure?.parent) { top = p; for (const e of (h.meta(p, 'errors') as any[]) ?? []) { const k = String(e?.kind ?? 'invalid'); if (!form.group.includes(k)) form.group.push(k); } }
            if (h.meta(top, 'invalid') === true || h.meta(top, 'valid') === false) form.invalid = true;
          }
        } catch { /* an unreadable control contributes nothing */ }
      }
      // A signal form does not list its other fields; an invalid form with valid own fields means something else is unfilled.
      if (form.invalid && !form.unfilled.length && !form.group.length && !form.fields.some((f: any) => f.status === 'INVALID')) form.unfilled.push('another field');
      if (before.some((x, i) => x !== h.mark(controls[i]))) {
        form.sideEffects = true;
        for (const c of controls) { try { c.updateValueAndValidity({ emitEvent: false }); } catch { /* left as the application set it */ } }
      }
      w.__probeForm = form;
    };
  }, trials);
}

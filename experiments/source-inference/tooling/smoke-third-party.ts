// Executes every runnable capability that needs no input against a live third-party app and reports whether the tool ran and the page changed.
// usage: tsx tooling/smoke-third-party.ts <tsconfig> <routes-entry> <base-url> [--hash]
import { chromium } from 'playwright';
import { compile } from '../src/compiler.js';
import { browserAdapter } from '../src/browser-adapter.js';
const [, , tsconfig, routes, base, ...flags] = process.argv;
const manifest = compile(tsconfig, routes);
const caps = manifest.capabilities.filter(c => c.status === 'candidate' && !((c.inputSchema as any).required?.length));
console.log(`${manifest.capabilities.length} capabilities, ${caps.length} runnable without input`);
const browser = await chromium.launch();
const tally: Record<string, number> = {};
for (const c of caps) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  let status = '';
  try {
    const adapter = browserAdapter(page, manifest, [{ id: c.id, fingerprint: c.fingerprint, description: 'smoke', effect: 'write' }], base, { hash: flags.includes('--hash') });
    const route = c.global ? '/' : c.route.replace(/:\w+/g, '1');
    await page.goto(flags.includes('--hash') ? `${base.replace(/\/$/, '')}/#${route}` : new URL(route, base).href); await page.waitForLoadState('networkidle');
    const snapshot = () => page.evaluate(() => document.body.innerHTML.replace(/_ng(content|host)-[\w-]+="[^"]*"/g, '').length + '|' + location.href + '|' + JSON.stringify(localStorage).length);
    const before = await snapshot();
    await adapter.invoke(adapter.tools[0].name, {});
    await page.waitForTimeout(400);
    const after = await snapshot();
    status = before !== after ? 'ran+changed' : 'ran-nochange';
    if (errors.length) status += '+pageerror';
    console.log(status.padEnd(22), c.component + '.' + c.handler, c.route);
  } catch (e) { status = 'tool-error'; console.log('tool-error'.padEnd(22), c.component + '.' + c.handler, c.route, String(e instanceof Error ? e.message : e).split('\n')[0].slice(0, 120)); }
  tally[status] = (tally[status] ?? 0) + 1;
  await context.close();
}
await browser.close();
console.log(JSON.stringify(tally));

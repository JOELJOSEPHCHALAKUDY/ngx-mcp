import { createRequire } from 'module';
const require = createRequire('/Users/joeljoseph/Desktop/Personal Work/ai-experiments-apps/angular-mcp-compiler/node_modules/');
const { chromium } = require('playwright');
import { cases, reset } from './oracles.mjs';
const base = 'http://127.0.0.1:4411';
const sel = async (page, trigger, opt) => { await page.click(trigger); await page.click(`mat-option:has-text("${opt}")`); };
const actions = {
  'add-contact': async (p, i) => { await p.fill('#name', i.name); await p.fill('#email', i.email); await p.fill('#phone', i.phone); await sel(p, '#group', i.group); await p.click('#save-btn'); },
  'edit-contact': async (p, i) => { await p.fill('#name', i.name); await p.fill('#email', i.email); await p.fill('#phone', i.phone); await sel(p, '#group', i.group); await p.fill('#company', i.company); await p.click('#save-btn'); },
  'delete-contact': async (p, i) => p.click(`tr[data-id="${i.id}"] .delete`),
  'toggle-favorite': async (p, i) => p.click(`tr[data-id="${i.id}"] .fav`),
  'clear-all': async (p) => { p.once('dialog', d => d.dismiss()); await p.click('#clear-all'); },
  'search': async (p, i) => p.fill('#search', i.value),
  'change-page': async (p) => p.click('button.mat-mdc-paginator-navigation-next'),
  'change-page-size': async (p) => { await p.click('mat-paginator mat-select', { force: true }); await p.click('mat-option:has-text("10")'); },
  'toggle-compact': async (p) => p.click('mat-slide-toggle button'),
  'change-theme': async (p) => { await p.click('mat-select'); await p.click('mat-option:has-text("dark")'); },
  'toggle-show-phone': async (p) => p.uncheck('#show-phone'),
  'sign-out': async (p) => { await p.click('.user-menu-trigger'); await p.click('.sign-out'); },
  'login': async (p, i) => { await p.fill('#username', i.username); await p.fill('#password', i.password); await p.click('#login-btn'); },
  'switch-user': async (p) => { await p.click('.user-menu-trigger'); await p.click('.switch-user'); },
};
const browser = await chromium.launch();
let bad = 0;
for (const c of cases) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  try {
    await page.goto(base); await reset(page, base);
    await c.setup(page, base);
    let before = 'passed';
    try { await c.verify(page, base); } catch (e) { before = 'failed'; }
    await actions[c.id](page, c.input);
    let after = 'passed', msg = '';
    try { await c.verify(page, base); } catch (e) { after = 'failed'; msg = e.message; }
    // clear-all: dismissed -> verify passes before & after. Now accept -> must fail.
    let extra = '';
    if (c.expectRefused) {
      await c.setup(page, base);
      page.once('dialog', d => d.accept()); await page.click('#clear-all');
      try { await c.verify(page, base); extra = ' | accept-case: verify PASSED (BAD)'; bad++; } catch { extra = ' | accept-case: verify failed as expected'; }
    }
    const ok = c.expectRefused ? after === 'passed' : (before === 'failed' && after === 'passed');
    if (!ok) bad++;
    console.log(`${ok ? 'OK ' : 'BAD'} ${c.id}: before=${before} after=${after} ${msg}${extra} ${errs.join(';')}`);
  } catch (e) { bad++; console.log('ERR', c.id, e.message.split('\n')[0]); }
  await ctx.close();
}
await browser.close(); console.log(bad ? `${bad} problems` : 'ALL OK');

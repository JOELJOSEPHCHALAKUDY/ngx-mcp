import { createRequire } from 'module';
import { cases, reset } from './oracles.mjs';
const require = createRequire('/Users/joeljoseph/Desktop/Personal Work/ai-experiments-apps/angular-mcp-compiler/package.json');
const { chromium } = require('playwright');
const base = 'http://127.0.0.1:4412';

const row = (page, text) => page.locator('mat-tab-body.mat-mdc-tab-body-active tr.mat-mdc-row', { hasText: text });
// What "the tool" does through the real UI for each case (my own selectors).
const act = {
  'add-item': (p) => p.getByRole('button', { name: 'Add item' }).click(),
  'edit-item': (p) => row(p, 'Stapler').getByRole('button', { name: 'Edit' }).click(),
  'archive-item': (p) => row(p, 'USB-C Cable').getByRole('button', { name: 'Archive' }).click(),
  'restore-item': (p) => row(p, 'Desk Lamp').getByRole('button', { name: 'Restore' }).click(),
  'delete-item': (p) => row(p, 'Cordless Drill').getByRole('button', { name: 'Delete' }).click(),
  'adjust-stock': async (p) => { await p.fill('input[name=delta]', '-20'); await p.getByRole('button', { name: 'Apply' }).click(); },
  'duplicate-item': (p) => p.getByRole('button', { name: 'Duplicate' }).click(),
  'change-report-range': (p) => p.locator('mat-button-toggle[value=month] button').click(),
  'export-csv': (p) => p.getByRole('button', { name: 'Export CSV' }).click(),
  'reset-demo-data': (p) => p.getByRole('button', { name: 'Reset demo data' }).click(),
  'sort-items': async (p) => { const h = p.locator('th', { hasText: 'Quantity' }); await h.click(); await h.click(); },
  'change-tab': (p) => p.getByRole('tab', { name: 'Archived' }).click(),
};

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
let bad = 0;
for (const c of cases) {
  try {
    await reset(page, base);
    await c.setup?.(page, base);
    let before = true;
    try { await c.verify(page, base); } catch { before = false; }
    if (before) throw new Error('verify passed BEFORE action');
    await act[c.id](page);
    await c.humanSteps?.(page);
    await c.verify(page, base);
    console.log('PASS', c.id);
  } catch (e) { bad++; console.log('FAIL', c.id, e.message.split('\n')[0]); }
}
console.log('page errors:', errs);
await browser.close();
process.exit(bad ? 1 : 0);

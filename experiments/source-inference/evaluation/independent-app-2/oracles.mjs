// Behavioural oracles for the Inventory app.
const KEY = 'inv.items';

const items = (page) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);

async function until(fn, what, ms = 4000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      const r = await fn();
      if (r) return r;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`verify failed: ${what}${last ? ' (' + last.message + ')' : ''}`);
}

const find = async (page, id) => ((await items(page)) || []).find((i) => i.id === id);

const gotoItems = async (page, base) => {
  await page.goto(base + '/items');
  await page.waitForSelector('tr.mat-mdc-row');
};

const rowTexts = (page) =>
  page.$$eval('mat-tab-body.mat-mdc-tab-body-active tr.mat-mdc-row', (rs) => rs.map((r) => r.innerText.replace(/\s+/g, ' ').trim()));

const dialog = (page) => page.locator('mat-dialog-container');

export async function reset(page, base) {
  await page.goto(base + '/items');
  await page.evaluate(() => localStorage.clear());
  await page.goto(base + '/items');
  await page.waitForSelector('tr.mat-mdc-row');
}

const NEW_ITEM = { name: 'Widget', sku: 'WDG-101', quantity: 5, category: 'Tools', perishable: true };

async function fillDialog(page, v) {
  const d = dialog(page);
  await d.waitFor();
  if (v.name !== undefined) await d.locator('input[formcontrolname=name]').fill(v.name);
  if (v.sku !== undefined) await d.locator('input[formcontrolname=sku]').fill(v.sku);
  if (v.quantity !== undefined) await d.locator('input[formcontrolname=quantity]').fill(String(v.quantity));
  if (v.category !== undefined) {
    await d.locator('mat-select[formcontrolname=category]').click();
    await page.locator('mat-option', { hasText: v.category }).first().click();
  }
  if (v.perishable !== undefined) {
    const cb = d.locator('mat-checkbox[formcontrolname=perishable] input');
    if ((await cb.isChecked()) !== v.perishable) await cb.click();
  }
}

async function saveDialog(page) {
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await dialog(page).waitFor({ state: 'detached' });
}

export const cases = [
  {
    id: 'add-item',
    component: 'ItemsListComponent',
    handler: 'openAdd',
    route: '/items',
    input: {},
    setup: async (page, base) => gotoItems(page, base),
    humanSteps: async (page) => {
      await fillDialog(page, NEW_ITEM);
      await saveDialog(page);
    },
    verify: async (page) => {
      const all = await items(page);
      const it = all.find((i) => i.sku === 'WDG-101');
      if (!it) throw new Error('verify failed: new item not stored');
      if (all.length !== 9) throw new Error('verify failed: expected 9 items, got ' + all.length);
      if (it.name !== 'Widget' || it.quantity !== 5 || it.category !== 'Tools' || it.perishable !== true || it.archived !== false)
        throw new Error('verify failed: stored fields wrong ' + JSON.stringify(it));
      await until(async () => (await rowTexts(page)).some((t) => t.includes('Widget')), 'list shows Widget');
    },
  },
  {
    id: 'edit-item',
    component: 'ItemsListComponent',
    handler: 'openEdit',
    route: '/items',
    input: { item: { id: 'itm-3' } },
    setup: async (page, base) => gotoItems(page, base),
    humanSteps: async (page) => {
      await fillDialog(page, { name: 'Stapler Pro', quantity: 99, category: 'Tools' });
      await saveDialog(page);
    },
    verify: async (page) => {
      const it = await find(page, 'itm-3');
      if (!it) throw new Error('verify failed: itm-3 vanished');
      if (it.name !== 'Stapler Pro' || it.quantity !== 99 || it.category !== 'Tools' || it.sku !== 'STP-003')
        throw new Error('verify failed: edit not stored ' + JSON.stringify(it));
      if ((await items(page)).length !== 8) throw new Error('verify failed: item count changed');
      await until(async () => (await rowTexts(page)).some((t) => t.includes('Stapler Pro')), 'list shows Stapler Pro');
    },
  },
  {
    id: 'archive-item',
    component: 'ItemsListComponent',
    handler: 'toggleArchive',
    route: '/items',
    input: { item: { id: 'itm-1' } },
    setup: async (page, base) => gotoItems(page, base),
    verify: async (page) => {
      await until(async () => (await find(page, 'itm-1'))?.archived === true, 'itm-1 archived flag');
      await until(async () => !(await rowTexts(page)).some((t) => t.includes('USB-C Cable')), 'row left Active tab');
    },
  },
  {
    id: 'restore-item',
    component: 'ItemsListComponent',
    handler: 'toggleArchive',
    route: '/items',
    input: { item: { id: 'itm-7' } },
    setup: async (page, base) => {
      await gotoItems(page, base);
      await page.getByRole('tab', { name: 'Archived' }).click();
      await page.locator('mat-tab-body.mat-mdc-tab-body-active tr.mat-mdc-row', { hasText: 'Desk Lamp' }).waitFor();
    },
    verify: async (page) => {
      await until(async () => (await find(page, 'itm-7'))?.archived === false, 'itm-7 restored');
      await until(async () => !(await rowTexts(page)).some((t) => t.includes('Desk Lamp')), 'row left Archived tab');
    },
  },
  {
    id: 'delete-item',
    component: 'ItemsListComponent',
    handler: 'confirmDelete',
    route: '/items',
    input: { item: { id: 'itm-4' } },
    setup: async (page, base) => gotoItems(page, base),
    humanSteps: async (page) => {
      await dialog(page).getByRole('button', { name: 'Yes' }).click();
      await dialog(page).waitFor({ state: 'detached' });
    },
    verify: async (page) => {
      await until(async () => !(await find(page, 'itm-4')), 'itm-4 deleted from API store');
      if ((await items(page)).length !== 7) throw new Error('verify failed: expected 7 items');
      await until(async () => !(await rowTexts(page)).some((t) => t.includes('Cordless Drill')), 'row removed from list');
    },
  },
  {
    id: 'adjust-stock',
    component: 'ItemDetailComponent',
    handler: 'applyAdjust',
    route: '/items/:id',
    input: { id: 'itm-1', delta: -20 },
    setup: async (page, base) => {
      await page.goto(base + '/items/itm-1');
      await page.waitForSelector('#item-name');
    },
    verify: async (page) => {
      await until(async () => (await find(page, 'itm-1'))?.quantity === 100, 'itm-1 quantity 120 -> 100');
      await until(async () => (await page.textContent('#item-qty')).trim() === '100', 'detail shows 100');
    },
  },
  {
    id: 'duplicate-item',
    component: 'ItemDetailComponent',
    handler: 'duplicate',
    route: '/items/:id',
    input: { id: 'itm-2' },
    setup: async (page, base) => {
      await page.goto(base + '/items/itm-2');
      await page.waitForSelector('#item-name');
    },
    verify: async (page) => {
      const all = await until(async () => {
        const a = await items(page);
        return a.length === 9 ? a : null;
      }, 'a 9th item was created');
      const copy = all.find((i) => i.name === 'Whole Milk (copy)');
      if (!copy) throw new Error('verify failed: copy not stored');
      if (copy.id === 'itm-2' || copy.category !== 'Grocery' || copy.quantity !== 40 || copy.perishable !== true)
        throw new Error('verify failed: copy fields wrong ' + JSON.stringify(copy));
      await until(async () => new URL(page.url()).pathname === '/items/' + copy.id, 'navigated to the copy');
      await until(async () => (await page.textContent('#item-name')).includes('(copy)'), 'detail shows copy');
    },
  },
  {
    id: 'change-report-range',
    component: 'ReportsComponent',
    handler: 'setRange',
    route: '/reports',
    input: { range: 'month' },
    setup: async (page, base) => {
      await page.goto(base + '/reports');
      await page.waitForSelector('mat-button-toggle-group');
    },
    verify: async (page) => {
      await until(async () => (await page.textContent('#range-label')).includes('Last 30 days'), 'label shows month range');
      await until(async () => (await page.locator('mat-button-toggle[value=month] button').getAttribute('aria-checked')) === 'true', 'Month toggle checked');
    },
  },
  {
    id: 'export-csv',
    component: 'ReportsComponent',
    handler: 'exportCsv',
    route: '/reports',
    input: {},
    setup: async (page, base) => {
      await page.goto(base + '/reports');
      await page.evaluate(() => localStorage.removeItem('lastExport'));
      await page.locator('mat-button-toggle[value=month] button').click();
      await page.waitForFunction(() => document.querySelector('#range-label').textContent.includes('30'));
    },
    verify: async (page) => {
      await until(async () => (await page.evaluate(() => localStorage.getItem('lastExport'))) === 'month', 'localStorage lastExport=month');
      await until(async () => (await page.textContent('#last-export'))?.includes('month'), 'lastExport signal rendered');
    },
  },
  {
    id: 'reset-demo-data',
    component: 'AppComponent',
    handler: 'resetDemo',
    route: '/items',
    input: {},
    setup: async (page, base) => {
      await gotoItems(page, base);
      await page.evaluate((k) => {
        const a = JSON.parse(localStorage.getItem(k)).filter((i) => i.id !== 'itm-1' && i.id !== 'itm-2');
        a[0].name = 'Tampered';
        localStorage.setItem(k, JSON.stringify(a));
      }, KEY);
      await page.reload();
      await page.waitForSelector('tr.mat-mdc-row');
    },
    verify: async (page) => {
      await until(async () => {
        const a = await items(page);
        return a.length === 8 && a.some((i) => i.id === 'itm-1' && i.name === 'USB-C Cable') && !a.some((i) => i.name === 'Tampered');
      }, 'seed data restored');
      await until(async () => (await rowTexts(page)).some((t) => t.includes('USB-C Cable')), 'list shows reseeded items');
    },
  },
  {
    id: 'sort-items',
    component: 'ItemsListComponent',
    handler: 'onSort',
    route: '/items',
    input: { active: 'quantity', direction: 'desc' },
    setup: async (page, base) => gotoItems(page, base),
    verify: async (page) => {
      await until(async () => {
        const t = await rowTexts(page);
        return t.length === 6 && t[0].includes('USB-C Cable') && t[1].includes('Whole Milk') && t[5].includes('Cordless Drill');
      }, 'rows ordered by quantity descending');
      const aria = await page.locator('th', { hasText: 'Quantity' }).getAttribute('aria-sort');
      if (aria !== 'descending') throw new Error('verify failed: Quantity header aria-sort=' + aria);
    },
  },
  {
    id: 'change-tab',
    component: 'ItemsListComponent',
    handler: 'onTabChange',
    route: '/items',
    input: { index: 1 },
    setup: async (page, base) => gotoItems(page, base),
    verify: async (page) => {
      await until(async () => {
        const t = await rowTexts(page);
        return t.length === 2 && t.some((x) => x.includes('Desk Lamp')) && t.some((x) => x.includes('Wireless Mouse'));
      }, 'Archived tab rows shown');
      const sel = await page.getByRole('tab', { name: 'Archived' }).getAttribute('aria-selected');
      if (sel !== 'true') throw new Error('verify failed: Archived tab not selected');
    },
  },
];

// Oracles for the Contacts app. `page` is a Playwright Page on the app origin `base`.
const ls = (page, k) => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), k);
const contacts = page => ls(page, 'contacts');
const settings = page => ls(page, 'settings');
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const path = page => new URL(page.url()).pathname;
const names = page => page.$$eval('#contacts-table tbody tr .name', els => els.map(e => e.textContent.trim()));

export async function reset(page, base) {
  await page.goto(base + '/contacts');
  await page.evaluate(() => localStorage.clear());
  await page.goto(base + '/contacts');
  await page.waitForSelector('#contacts-table tbody tr');
}
const at = (route) => async (page, base) => { await reset(page, base); await page.goto(base + route); await page.waitForLoadState('networkidle'); };

export const cases = [
  { id: 'add-contact', component: 'ContactNewComponent', handler: 'onSubmit', route: '/contacts/new',
    input: { name: 'Zed Zebra', email: 'zed@example.com', phone: '5551234567', group: 'Work' },
    setup: at('/contacts/new'),
    verify: async (page) => {
      const l = await contacts(page);
      eq(l.length, 13, 'contact count');
      const c = l.find(x => x.email === 'zed@example.com');
      if (!c) throw new Error('new contact not stored');
      eq(c.name, 'Zed Zebra', 'name'); eq(c.phone, '5551234567', 'phone'); eq(c.group, 'Work', 'group'); eq(c.favorite, false, 'favorite');
      eq(path(page), '/contacts', 'url');
    } },
  { id: 'edit-contact', component: 'ContactEditComponent', handler: 'onSave', route: '/contacts/:id/edit',
    input: { id: 'c2', name: 'Renamed Two', email: 'two@new.example.com', phone: '5559998888', group: 'Work', company: 'Acme' },
    setup: at('/contacts/c2/edit'),
    verify: async (page) => {
      const l = await contacts(page);
      eq(l.length, 12, 'contact count');
      const c = l.find(x => x.id === 'c2');
      eq(c.name, 'Renamed Two', 'name'); eq(c.email, 'two@new.example.com', 'email'); eq(c.phone, '5559998888', 'phone');
      eq(c.group, 'Work', 'group'); eq(c.company, 'Acme', 'company');
      eq(l.find(x => x.id === 'c1').name, 'Person A', 'other contact untouched');
      eq(path(page), '/contacts', 'url');
    } },
  { id: 'delete-contact', component: 'ContactListComponent', handler: 'onDelete', route: '/contacts',
    input: { id: 'c3' }, setup: at('/contacts'),
    verify: async (page) => {
      const l = await contacts(page);
      eq(l.length, 11, 'contact count');
      if (l.some(c => c.id === 'c3')) throw new Error('c3 still stored');
      await page.waitForFunction(() => !document.querySelector('tr[data-id="c3"]'), null, { timeout: 3000 }).catch(() => { throw new Error('row c3 still in DOM'); });
    } },
  { id: 'toggle-favorite', component: 'ContactListComponent', handler: 'onToggleFavorite', route: '/contacts',
    input: { id: 'c4' }, setup: at('/contacts'),
    verify: async (page) => {
      const l = await contacts(page);
      eq(l.find(c => c.id === 'c4').favorite, true, 'c4 favorite');
      eq(l.filter(c => c.favorite).length, 1, 'only one favorite');
      await page.waitForFunction(() => document.querySelector('tr[data-id="c4"] .fav')?.getAttribute('aria-pressed') === 'true', null, { timeout: 3000 }).catch(() => { throw new Error('star not shown as pressed'); });
    } },
  { id: 'clear-all', component: 'ContactListComponent', handler: 'onClearAll', route: '/contacts',
    input: {}, expectRefused: true, setup: at('/contacts'),
    // Outcome for an unattended tool: native confirm must NOT be auto-accepted, so data stays intact.
    verify: async (page) => {
      eq((await contacts(page)).length, 12, 'contacts must remain (confirm not accepted)');
    } },
  { id: 'search', component: 'ContactListComponent', handler: 'onSearch', route: '/contacts',
    input: { value: 'Person C' }, setup: at('/contacts'),
    verify: async (page) => {
      await page.waitForFunction(() => document.querySelectorAll('#contacts-table tbody tr').length === 1, null, { timeout: 3000 });
      eq((await names(page))[0], 'Person C', 'filtered row');
    } },
  { id: 'change-page', component: 'ContactListComponent', handler: 'onPage', route: '/contacts',
    input: { pageIndex: 1, pageSize: 5 }, setup: at('/contacts'),
    verify: async (page) => {
      await page.waitForFunction(() => document.querySelector('#contacts-table tbody tr .name')?.textContent.trim() === 'Person F', null, { timeout: 3000 });
      const n = await names(page);
      eq(n.length, 5, 'rows on page 2'); eq(n[0], 'Person F', 'first row');
    } },
  { id: 'change-page-size', component: 'ContactListComponent', handler: 'onPage', route: '/contacts',
    input: { pageIndex: 0, pageSize: 10 }, setup: at('/contacts'),
    verify: async (page) => {
      await page.waitForFunction(() => document.querySelectorAll('#contacts-table tbody tr').length === 10, null, { timeout: 3000 });
      eq((await names(page))[9], 'Person J', 'tenth row');
    } },
  { id: 'toggle-compact', component: 'SettingsComponent', handler: 'onCompactChange', route: '/settings',
    input: { checked: true }, setup: at('/settings'),
    verify: async (page) => {
      eq((await settings(page)).compact, true, 'settings.compact');
      eq((await settings(page)).theme, 'light', 'theme untouched');
    } },
  { id: 'change-theme', component: 'SettingsComponent', handler: 'onThemeChange', route: '/settings',
    input: { value: 'dark' }, setup: at('/settings'),
    verify: async (page) => {
      eq((await settings(page)).theme, 'dark', 'settings.theme');
      eq(await page.evaluate(() => document.body.classList.contains('theme-dark')), true, 'body class');
    } },
  { id: 'toggle-show-phone', component: 'SettingsComponent', handler: 'onShowPhoneChange', route: '/settings',
    input: { checked: false }, setup: at('/settings'),
    verify: async (page) => {
      eq((await settings(page)).showPhone, false, 'settings.showPhone');
      eq((await settings(page)).compact, false, 'compact untouched');
    } },
  { id: 'sign-out', component: 'App', handler: 'signOut', route: '/contacts',
    input: {}, setup: at('/contacts'),
    verify: async (page) => {
      eq(await page.evaluate(() => localStorage.getItem('session')), null, 'session key');
      await page.waitForURL('**/login', { timeout: 3000 });
      eq(path(page), '/login', 'url');
    } },
  { id: 'login', component: 'LoginComponent', handler: 'onLogin', route: '/login',
    input: { username: 'alice', password: 'secret' },
    setup: async (page, base) => { await reset(page, base); await page.evaluate(() => localStorage.removeItem('session')); await page.goto(base + '/login'); await page.waitForSelector('#username'); },
    verify: async (page) => {
      const s = await ls(page, 'session');
      eq(s && s.user, 'alice', 'session.user');
      await page.waitForURL('**/contacts', { timeout: 3000 });
    } },
  { id: 'switch-user', component: 'App', handler: 'switchUser', route: '/contacts',
    input: {}, setup: at('/contacts'),
    verify: async (page) => {
      eq((await ls(page, 'session')).user, 'guest', 'session.user');
      eq((await page.textContent('.who')).trim(), 'guest', 'toolbar user label');
    } },
];

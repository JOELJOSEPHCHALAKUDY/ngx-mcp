import { UserListPage, UserEditPage, ItemsPage, VerifyPage, PagerPage, LangMenu, SearchPage, StockPage, ProjectPage } from './app';
const PATHS = { users: 'users-const' } as const;
enum Segment { Pager = 'pager-' }
export const routes = [
  { path: PATHS.users, component: UserListPage },
  { path: `${Segment.Pager}tpl`, component: PagerPage },
  { path: 'users', component: UserListPage },
  { path: 'users/new', component: UserEditPage },
  { path: 'users/:id', component: UserEditPage },
  { path: 'items', component: ItemsPage },
  { path: 'verify', component: VerifyPage },
  { path: 'pager', component: PagerPage },
  { path: 'lang', component: LangMenu },
  { path: 'search', component: SearchPage },
  { path: 'stock', component: StockPage },
  { path: 'projects/:id', component: ProjectPage },
];

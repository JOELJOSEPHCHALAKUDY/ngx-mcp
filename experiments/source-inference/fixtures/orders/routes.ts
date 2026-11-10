import { OrdersPage, PreviewPage, ConstructorPage, OrdersService, PreviewOrdersService } from './app';
import {SignalExample,DraftExample,ShadowStorage} from './workflows';
const aliasedLazy=()=>import('./lazy').then(m=>m.lazyRoutes);
export const routes = [
  { path: 'orders', component: OrdersPage, canActivate: [() => true] },
  { path: 'preview', component: PreviewPage },
  { path: 'constructor', component: ConstructorPage },
  { path: 'override', component: OrdersPage, providers: [{ provide: OrdersService, useClass: PreviewOrdersService }] },
  { path: 'factory', component: OrdersPage, providers: [{ provide: OrdersService, useFactory: () => new OrdersService() }] },
  { path: 'lazy', loadChildren: () => import('./lazy').then(m => m.lazyRoutes) },
  { path: 'lazy-component', loadComponent: () => import('./app').then(m => m.ConstructorPage) },
  {path:'aliased-lazy',loadChildren:aliasedLazy},
  {path:'default-export',loadComponent:()=>import('./default')},
  {path:'signal',component:SignalExample},
  {path:'draft',component:DraftExample},
  {path:'shadow-storage',component:ShadowStorage},
];

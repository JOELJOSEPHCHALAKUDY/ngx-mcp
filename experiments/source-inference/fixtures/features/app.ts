import { Component, Injectable, inject, input, output } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

export interface Item { id: string; name: string }

@Injectable({ providedIn: 'root' })
export class UserApi {
  save(user: { email: string; password: string }): Promise<void> { return Promise.resolve(); }
  remove(id: string): Promise<void> { return Promise.resolve(); }
}
@Injectable({ providedIn: 'root' })
export class ItemsApi {
  delete(id: string): Promise<void> { return Promise.resolve(); }
}
@Injectable({ providedIn: 'root' })
export class AuthApi {
  logout(): Promise<void> { return Promise.resolve(); }
  verify(token: string): Promise<void> { return Promise.resolve(); }
}

@Component({ selector: 'user-list', standalone: true, template: `
  <table><tr *ngFor="let user of users"><td>{{ user.name }}</td>
    <td><button class="del" (click)="deleteUser(user.id)">Delete</button></td></tr></table>` })
export class UserListPage {
  users: { id: string; name: string }[] = [];
  private api = inject(UserApi);
  deleteUser(id: string) { this.api.remove(id); }
}

@Component({ selector: 'user-edit', standalone: true, imports: [ReactiveFormsModule], template: `
  <form [formGroup]="form" (ngSubmit)="save()">
    <input formControlName="email" type="email"><input formControlName="password" type="password">
    <button type="submit">Save</button>
  </form>` })
export class UserEditPage {
  id?: string;
  form;
  constructor(private fb: FormBuilder, private route: ActivatedRoute, private api: UserApi) {
    this.id = this.route.snapshot.params['id'];
    this.form = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.minLength(6), ...(!this.id ? [Validators.required] : [])]],
    });
  }
  save() {
    if (this.form.invalid) return;
    this.api.save(this.form.value as { email: string; password: string });
  }
}

@Component({ selector: 'item-list', standalone: true, template: `
  @for (item of items(); track item.id) { <div><button class="x" (click)="onRemove(item)">Remove {{ item.name }}</button></div> }` })
export class ItemList {
  items = input<Item[]>([]);
  remove = output<Item>();
  onRemove(item: Item) { this.remove.emit(item); }
}
@Component({ selector: 'items-page', standalone: true, imports: [ItemList], template: `<item-list [items]="items" (remove)="removeItem($event)"></item-list>` })
export class ItemsPage {
  items: Item[] = [];
  private api = inject(ItemsApi);
  removeItem(item: Item) { this.api.delete(item.id); }
}

@Component({ selector: 'verify-page', standalone: true, template: `<p>Verifying</p>` })
export class VerifyPage {
  constructor(private route: ActivatedRoute, private router: Router, private auth: AuthApi) {}
  ngOnInit() {
    const token = this.route.snapshot.queryParams['token'];
    this.auth.verify(token).then(() => { this.router.navigate(['/login']); });
  }
}

@Component({ selector: 'pager-page', standalone: true, template: `<mat-paginator [pageSizeOptions]="[5, 10]" (page)="onPage($event)"></mat-paginator>` })
export class PagerPage {
  onPage(event: { pageIndex: number; pageSize: number }) { inject(ItemsApi); }
}

@Component({ selector: 'app-root', standalone: true, template: `<nav><button class="out" (click)="logout()">Logout</button></nav><router-outlet></router-outlet>` })
export class AppRoot {
  private auth = inject(AuthApi);
  logout() { this.auth.logout(); }
}
declare function bootstrapApplication(root: unknown): void;
bootstrapApplication(AppRoot);

@Component({ selector: 'lang-menu', standalone: true, template: `
  <button class="trigger" [matMenuTriggerFor]="menu">Language</button>
  <mat-menu #menu="matMenu">
    @for (lang of langs; track lang.value) { <button mat-menu-item (click)="setLang(lang.value)">{{ lang.name }}</button> }
  </mat-menu>` })
export class LangMenu {
  langs = [{ value: 'en', name: 'English' }, { value: 'fr', name: 'French' }];
  private api = inject(LangApi);
  setLang(value: string) { this.api.set(value); }
}
@Injectable({ providedIn: 'root' })
export class LangApi { set(value: string): void {} }

@Injectable({ providedIn: 'root' })
export class SearchApi { find(query: { q: string }): void {} set(change: { theme: string }): void {} go(): void {} }

@Component({ selector: 'search-page', standalone: true, template: `
  <form class="filters"><input name="q" [(ngModel)]="query.q">
    <button class="act" (click)="search()">Search</button><button class="act" (click)="clear()">Clear</button></form>
  <input class="filter" (input)="onFilter($any($event.target).value)">
  <div *ngIf="state as s"><button class="go" (click)="go()">Go {{ s }}</button></div>
  <mat-select (selectionChange)="onTheme($event)"><mat-option *ngFor="let t of themes" [value]="t.value">{{ t.label }}</mat-option></mat-select>` })
export class SearchPage {
  query = { q: '' };
  state = 'on';
  themes = [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }];
  private api = inject(SearchApi);
  search() { this.api.find(this.query); }
  clear() { this.query = { q: '' }; this.api.find(this.query); }
  go() { this.api.go(); }
  onFilter(text: string) { this.api.find({ q: text }); }
  onTheme(event: { value: string }) { this.api.set({ theme: event.value }); }
}

class MatDialog { open(component: unknown, config?: unknown): { afterClosed(): { subscribe(cb: (r: unknown) => void): void } } { return { afterClosed: () => ({ subscribe: () => undefined }) }; } }
class MatDialogRef { close(result?: unknown): void {} }
@Injectable({ providedIn: 'root' })
export class StockApi { save(item: { name: string; qty: number }): void {} remove(id: string): void {} }
@Component({ selector: 'stock-dialog', standalone: true, imports: [ReactiveFormsModule], template: `
  <form [formGroup]="form" (ngSubmit)="save()"><input formControlName="name"><input formControlName="qty" type="number"><button type="submit">Save</button></form>` })
export class StockDialog {
  private ref = inject(MatDialogRef);
  private fb = inject(FormBuilder);
  form = this.fb.group({ name: ['', Validators.required], qty: [0, Validators.min(0)] });
  save() { if (this.form.invalid) return; this.ref.close(this.form.value); }
}
@Component({ selector: 'confirm-box', standalone: true, template: `<button class="yes" (click)="yes()">Yes</button><button class="no" (click)="no()">No</button>` })
export class ConfirmBox { private ref = inject(MatDialogRef); yes() { this.ref.close(true); } no() { this.ref.close(false); } }
@Component({ selector: 'stock-page', standalone: true, template: `
  <button class="add" (click)="openAdd()">Add</button>
  <ul><li *matRowDef="let row"><button class="edit" (click)="openEdit(row)">Edit</button><button class="del" (click)="askDelete(row)">Delete</button></li></ul>` })
export class StockPage {
  private dialog = inject(MatDialog);
  private api = inject(StockApi);
  openAdd() { this.dialog.open(StockDialog).afterClosed().subscribe(r => this.api.save(r as { name: string; qty: number })); }
  openEdit(row: { id: string; name: string }) { this.dialog.open(StockDialog, { data: row }).afterClosed().subscribe(r => this.api.save(r as { name: string; qty: number })); }
  askDelete(row: { id: string }) { this.dialog.open(ConfirmBox).afterClosed().subscribe(ok => { if (ok) this.api.remove(row.id); }); }
}

@Component({ selector: 'confirm-delete', standalone: true, template: `<button class="del" (click)="confirm()">Delete</button>` })
export class ConfirmDelete {
  private ref = inject(MatDialogRef);
  private api = inject(StockApi);
  confirm() { this.api.remove('x').then(() => this.ref.close()); }
}
@Component({ selector: 'project-page', standalone: true, template: `
  <button class="rm" *ngFor="let task of tasks" (click)="remove(task)">Remove</button>
  <button class="drop" (click)="dropProject()">Drop project</button>` })
export class ProjectPage {
  private dialog = inject(MatDialog);
  private api = inject(StockApi);
  tasks: { id: string }[] = [];
  remove(task: { id: string }) { this.api.remove(task.id); }
  dropProject() { this.dialog.open(ConfirmDelete); }
}

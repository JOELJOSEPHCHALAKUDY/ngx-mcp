import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { ContactService } from './contact.service';
import { SettingsService } from './settings.service';
import { Contact } from './models';

@Component({
  selector: 'app-contact-list',
  imports: [RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, MatPaginatorModule],
  template: `
    <div class="page">
      <div style="display:flex;gap:12px;align-items:center">
        <mat-form-field style="flex:1"><mat-label>Search</mat-label>
          <input matInput id="search" (input)="onSearch($any($event.target).value)"></mat-form-field>
        <button mat-stroked-button id="clear-all" (click)="onClearAll()">Clear all</button>
      </div>
      <table [class.compact]="settings.settings().compact" id="contacts-table">
        <thead><tr><th>Name</th><th>Email</th>@if (settings.settings().showPhone) {<th>Phone</th>}<th>Group</th><th></th></tr></thead>
        <tbody>
          @for (c of pageItems(); track c.id) {
            <tr [attr.data-id]="c.id" [style.height.px]="settings.settings().compact ? 28 : 48">
              <td class="name">{{ c.name }}</td><td>{{ c.email }}</td>
              @if (settings.settings().showPhone) {<td class="phone">{{ c.phone }}</td>}
              <td>{{ c.group }}</td>
              <td>
                <button mat-button class="fav" [attr.aria-pressed]="c.favorite" (click)="onToggleFavorite(c)">{{ c.favorite ? '★' : '☆' }}</button>
                <a mat-button class="edit" [routerLink]="['/contacts', c.id, 'edit']">Edit</a>
                <button mat-button class="delete" (click)="onDelete(c)">Delete</button>
              </td>
            </tr>
          }
        </tbody>
      </table>
      @if (!filtered().length) { <p class="empty">No contacts</p> }
      <mat-paginator [length]="filtered().length" [pageSize]="pageSize()" [pageIndex]="pageIndex()"
        [pageSizeOptions]="[5, 10, 25]" (page)="onPage($event)"></mat-paginator>
    </div>`,
})
export class ContactListComponent {
  private svc = inject(ContactService);
  settings = inject(SettingsService);
  contacts = signal<Contact[]>(this.svc.getAll());
  query = signal('');
  pageIndex = signal(0);
  pageSize = signal(5);
  private timer?: ReturnType<typeof setTimeout>;
  filtered = computed(() => {
    const q = this.query().toLowerCase();
    return this.contacts().filter(c => !q || c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q));
  });
  pageItems = computed(() => this.filtered().slice(this.pageIndex() * this.pageSize(), (this.pageIndex() + 1) * this.pageSize()));

  private refresh() { this.contacts.set(this.svc.getAll()); }
  onSearch(value: string) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.query.set(value); this.pageIndex.set(0); }, 250);
  }
  onPage(e: PageEvent) { this.pageIndex.set(e.pageIndex); this.pageSize.set(e.pageSize); }
  onDelete(c: Contact) { this.svc.remove(c.id); this.refresh(); }
  onToggleFavorite(c: Contact) { this.svc.toggleFavorite(c.id); this.refresh(); }
  onClearAll() {
    if (window.confirm('Delete all contacts?')) { this.svc.clear(); this.refresh(); }
  }
}

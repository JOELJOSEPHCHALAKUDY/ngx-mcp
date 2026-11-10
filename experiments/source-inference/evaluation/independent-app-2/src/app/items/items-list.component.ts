import { Component, OnInit, computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { Sort } from '@angular/material/sort';
import { Item } from '../item.model';
import { ItemService } from '../item.service';
import { ItemDialogComponent } from './item-dialog.component';
import { ConfirmDialogComponent } from './confirm-dialog.component';

@Component({
  selector: 'app-items-list',
  template: `
    <div class="page">
      <div class="row">
        <h2>Items</h2>
        <span class="spacer"></span>
        <button mat-raised-button color="primary" (click)="openAdd()">Add item</button>
      </div>
      <mat-tab-group [selectedIndex]="tabIndex()" (selectedIndexChange)="onTabChange($event)">
        <mat-tab label="Active"><ng-container *ngTemplateOutlet="tbl"></ng-container></mat-tab>
        <mat-tab label="Archived"><ng-container *ngTemplateOutlet="tbl"></ng-container></mat-tab>
      </mat-tab-group>
    </div>

    <ng-template #tbl>
      <table mat-table [dataSource]="rows()" matSort
             [matSortActive]="sort().active" [matSortDirection]="sort().direction"
             (matSortChange)="onSort($event)">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef mat-sort-header>Name</th>
          <td mat-cell *matCellDef="let item"><a [routerLink]="['/items', item.id]">{{ item.name }}</a></td>
        </ng-container>
        <ng-container matColumnDef="sku">
          <th mat-header-cell *matHeaderCellDef mat-sort-header>SKU</th>
          <td mat-cell *matCellDef="let item">{{ item.sku }}</td>
        </ng-container>
        <ng-container matColumnDef="quantity">
          <th mat-header-cell *matHeaderCellDef mat-sort-header>Quantity</th>
          <td mat-cell *matCellDef="let item">{{ item.quantity }}</td>
        </ng-container>
        <ng-container matColumnDef="category">
          <th mat-header-cell *matHeaderCellDef mat-sort-header>Category</th>
          <td mat-cell *matCellDef="let item">{{ item.category }}</td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef>Actions</th>
          <td mat-cell *matCellDef="let item">
            <button mat-button (click)="openEdit(item)">Edit</button>
            <button mat-button (click)="toggleArchive(item)">{{ item.archived ? 'Restore' : 'Archive' }}</button>
            <button mat-button color="warn" (click)="confirmDelete(item)">Delete</button>
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns"></tr>
      </table>
      @if (rows().length === 0) {
        <p class="empty">No items.</p>
      }
    </ng-template>
  `,
  standalone: false,
})
export class ItemsListComponent implements OnInit {
  columns = ['name', 'sku', 'quantity', 'category', 'actions'];
  items = signal<Item[]>([]);
  tabIndex = signal(0);
  sort = signal<Sort>({ active: '', direction: '' });

  rows = computed(() => {
    const archived = this.tabIndex() === 1;
    const { active, direction } = this.sort();
    const data = this.items().filter(i => i.archived === archived);
    if (!active || !direction) return data;
    const dir = direction === 'asc' ? 1 : -1;
    return [...data].sort((a, b) => {
      const x = (a as any)[active];
      const y = (b as any)[active];
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  });

  constructor(
    private service: ItemService,
    private dialog: MatDialog,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.refresh();
    this.service.reseeded$.subscribe(() => this.refresh());
  }

  refresh(): void {
    this.service.list().subscribe(items => this.items.set(items));
  }

  onTabChange(index: number): void {
    this.tabIndex.set(index);
  }

  onSort(sort: Sort): void {
    this.sort.set(sort);
  }

  openAdd(): void {
    this.dialog
      .open(ItemDialogComponent, { data: {} })
      .afterClosed()
      .subscribe(saved => saved && this.refresh());
  }

  openEdit(item: Item): void {
    this.dialog
      .open(ItemDialogComponent, { data: { item } })
      .afterClosed()
      .subscribe(saved => saved && this.refresh());
  }

  toggleArchive(item: Item): void {
    this.service.setArchived(item, !item.archived).subscribe(() => this.refresh());
  }

  confirmDelete(item: Item): void {
    this.dialog
      .open(ConfirmDialogComponent, { data: { message: `Delete ${item.name}?` } })
      .afterClosed()
      .subscribe(yes => {
        if (yes) this.service.delete(item.id).subscribe(() => this.refresh());
      });
  }
}

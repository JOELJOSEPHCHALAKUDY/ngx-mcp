import { Component, Inject, OnInit, signal } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Item } from '../item.model';
import { ItemService } from '../item.service';

@Component({
  selector: 'app-item-dialog',
  template: `
    <h2 mat-dialog-title>{{ data.item ? 'Edit item' : 'Add item' }}</h2>
    <form [formGroup]="form" (ngSubmit)="save()">
      <mat-dialog-content>
        <div style="display:flex;flex-direction:column;gap:4px;min-width:320px">
          <mat-form-field>
            <mat-label>Name</mat-label>
            <input matInput formControlName="name" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>SKU</mat-label>
            <input matInput formControlName="sku" />
            @if (form.controls.sku.hasError('pattern')) {
              <mat-error>SKU must look like ABC-123</mat-error>
            }
          </mat-form-field>
          <mat-form-field>
            <mat-label>Quantity</mat-label>
            <input matInput type="number" formControlName="quantity" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Category</mat-label>
            <mat-select formControlName="category">
              @for (c of categories(); track c) {
                <mat-option [value]="c">{{ c }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-checkbox formControlName="perishable">Perishable</mat-checkbox>
        </div>
      </mat-dialog-content>
      <mat-dialog-actions>
        <button mat-button type="button" (click)="cancel()">Cancel</button>
        <button mat-raised-button color="primary" type="submit" [disabled]="form.invalid || saving()">Save</button>
      </mat-dialog-actions>
    </form>
  `,
  standalone: false,
})
export class ItemDialogComponent implements OnInit {
  categories = signal<string[]>([]);
  saving = signal(false);

  form = new FormBuilder().nonNullable.group({
    name: ['', Validators.required],
    sku: ['', [Validators.required, Validators.pattern(/^[A-Z]{3}-\d{3}$/)]],
    quantity: [0, [Validators.required, Validators.min(0)]],
    category: [''],
    perishable: [false],
  });

  constructor(
    private fb: FormBuilder,
    private items: ItemService,
    private ref: MatDialogRef<ItemDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: { item?: Item },
  ) {}

  ngOnInit(): void {
    this.items.categories().subscribe(c => this.categories.set(c));
    if (this.data.item) {
      const { name, sku, quantity, category, perishable } = this.data.item;
      this.form.setValue({ name, sku, quantity, category, perishable });
    }
  }

  save(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    const value = this.form.getRawValue();
    const req = this.data.item
      ? this.items.update(this.data.item.id, value)
      : this.items.create(value);
    req.subscribe(() => this.ref.close(true));
  }

  cancel(): void {
    this.ref.close(false);
  }
}

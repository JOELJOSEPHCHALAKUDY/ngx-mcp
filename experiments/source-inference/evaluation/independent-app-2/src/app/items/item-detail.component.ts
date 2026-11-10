import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Item } from '../item.model';
import { ItemService } from '../item.service';

@Component({
  selector: 'app-item-detail',
  template: `
    <div class="page">
      <a routerLink="/items">Back to items</a>
      @if (item(); as it) {
        <h2 id="item-name">{{ it.name }}</h2>
        <p>SKU: <span id="item-sku">{{ it.sku }}</span></p>
        <p>Category: {{ it.category }}</p>
        <p>Quantity: <span id="item-qty">{{ it.quantity }}</span></p>
        <form #f="ngForm" (ngSubmit)="applyAdjust()" class="row">
          <input type="number" name="delta" [(ngModel)]="delta" placeholder="Delta" aria-label="Delta" />
          <button mat-raised-button color="primary" type="submit">Apply</button>
        </form>
        <p><button mat-button (click)="duplicate()">Duplicate</button></p>
      } @else {
        <p>Loading...</p>
      }
    </div>
  `,
  standalone: false,
})
export class ItemDetailComponent implements OnInit {
  item = signal<Item | null>(null);
  delta = 0;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private service: ItemService,
  ) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe(p => {
      this.item.set(null);
      this.service.get(p.get('id')!).subscribe(i => this.item.set(i));
    });
  }

  applyAdjust(): void {
    const it = this.item();
    if (!it) return;
    this.service.adjustStock(it.id, Number(this.delta)).subscribe(updated => {
      this.item.set(updated);
      this.delta = 0;
    });
  }

  duplicate(): void {
    const it = this.item();
    if (!it) return;
    this.service.duplicate(it.id).subscribe(copy => this.router.navigate(['/items', copy.id]));
  }
}

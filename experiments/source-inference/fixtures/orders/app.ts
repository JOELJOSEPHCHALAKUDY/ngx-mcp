import { Component as View, Injectable, inject } from '@angular/core';

export interface Order { id: string; total: number; status: 'open' | 'closed'; notes?: string; }

@Injectable({ providedIn: 'root' })
export class OrdersService {
  async listOrders(): Promise<Order[]> { return []; }
  async getUserOrders(tags: string[], key: string | number, limit = 10): Promise<Order[]> { return []; }
  async deleteOrder(id: string): Promise<{ deleted: boolean }> { return { deleted: true }; }
  protected rebuildIndex(): void {}
  private secret(): void {}
  unknown(data: unknown): unknown { return data; }
}

@Injectable({ providedIn: 'root' })
export class PreviewOrdersService extends OrdersService {
  override async listOrders(): Promise<Order[]> { return [{ id: 'preview', total: 0, status: 'open' }]; }
}

@View({ selector: 'orders-page', standalone: true, template: `
  <button id="refresh" (click)="refresh()">Refresh orders</button>
  <button id="delete" (click)="requestDelete()">Delete order</button>
  <button id="hidden" (click)="reindex()" [hidden]="true">Reindex</button>
` })
export class OrdersPage {
  private orders = inject(OrdersService);
  refresh() { return this.reload(); }
  private reload() { return this.orders.listOrders(); }
  async requestDelete() {
    if (!window.confirm('Delete order selected-order?')) return { deleted: false };
    return this.orders.deleteOrder('selected-order');
  }
  reindex() { return 'not a service action'; }
}

@View({ selector: 'preview-page', standalone: true, template: '<button id="preview" (click)="refresh()">Preview</button>' })
export class PreviewPage {
  private orders = { listOrders: () => ['local preview'] };
  refresh() { return this.orders.listOrders(); }
}

@View({ selector: 'constructor-page', standalone: true, template: '<button id="load" (click)="load()">Load</button>' })
export class ConstructorPage {
  constructor(private service: OrdersService) {}
  load() { return this.service.getUserOrders(['open'], 123); }
}

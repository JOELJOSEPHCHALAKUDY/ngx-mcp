import { Injectable } from '@angular/core';
import {
  HttpEvent, HttpHandler, HttpInterceptor, HttpRequest, HttpResponse,
} from '@angular/common/http';
import { Observable, delay, of, throwError } from 'rxjs';
import { Item } from './item.model';

const KEY = 'inv.items';
const SEQ = 'inv.seq';
const CATEGORIES = ['Electronics', 'Grocery', 'Office', 'Tools', 'Apparel'];

const SEED: Item[] = [
  { id: 'itm-1', name: 'USB-C Cable', sku: 'CBL-001', quantity: 120, category: 'Electronics', perishable: false, archived: false },
  { id: 'itm-2', name: 'Whole Milk', sku: 'MLK-002', quantity: 40, category: 'Grocery', perishable: true, archived: false },
  { id: 'itm-3', name: 'Stapler', sku: 'STP-003', quantity: 15, category: 'Office', perishable: false, archived: false },
  { id: 'itm-4', name: 'Cordless Drill', sku: 'DRL-004', quantity: 7, category: 'Tools', perishable: false, archived: false },
  { id: 'itm-5', name: 'Rain Jacket', sku: 'JKT-005', quantity: 22, category: 'Apparel', perishable: false, archived: false },
  { id: 'itm-6', name: 'Fresh Bread', sku: 'BRD-006', quantity: 30, category: 'Grocery', perishable: true, archived: false },
  { id: 'itm-7', name: 'Desk Lamp', sku: 'LMP-007', quantity: 0, category: 'Office', perishable: false, archived: true },
  { id: 'itm-8', name: 'Wireless Mouse', sku: 'MSE-008', quantity: 64, category: 'Electronics', perishable: false, archived: true },
];

@Injectable()
export class FakeApiInterceptor implements HttpInterceptor {
  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    if (!req.url.startsWith('/api/')) {
      return next.handle(req);
    }
    const path = req.url.replace(/^\/api\//, '').split('?')[0];
    const parts = path.split('/');
    const items = this.load();

    const ok = (body: unknown, status = 200) =>
      of(new HttpResponse({ status, body })).pipe(delay(150));
    const fail = (status: number, message: string) =>
      throwError(() => ({ status, error: { message } })).pipe(delay(150));

    if (path === 'categories' && req.method === 'GET') {
      return ok(CATEGORIES);
    }
    if (path === 'reset' && req.method === 'POST') {
      localStorage.setItem(KEY, JSON.stringify(SEED));
      localStorage.setItem(SEQ, '8');
      return ok(null);
    }
    if (parts[0] !== 'items') {
      return fail(404, 'Not found');
    }
    const id = parts[1];
    if (!id) {
      if (req.method === 'GET') return ok(items);
      if (req.method === 'POST') {
        const seq = Number(localStorage.getItem(SEQ) ?? '8') + 1;
        localStorage.setItem(SEQ, String(seq));
        const created = { archived: false, ...(req.body as object), id: `itm-${seq}` } as Item;
        items.push(created);
        this.save(items);
        return ok(created, 201);
      }
    } else {
      const idx = items.findIndex(i => i.id === id);
      if (idx < 0) return fail(404, 'Item not found');
      if (req.method === 'GET') return ok(items[idx]);
      if (req.method === 'PUT') {
        items[idx] = { ...items[idx], ...(req.body as object), id };
        this.save(items);
        return ok(items[idx]);
      }
      if (req.method === 'DELETE') {
        items.splice(idx, 1);
        this.save(items);
        return ok(null);
      }
    }
    return fail(405, 'Method not allowed');
  }

  private load(): Item[] {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      localStorage.setItem(KEY, JSON.stringify(SEED));
      localStorage.setItem(SEQ, '8');
      return structuredClone(SEED);
    }
    return JSON.parse(raw);
  }

  private save(items: Item[]): void {
    localStorage.setItem(KEY, JSON.stringify(items));
  }
}

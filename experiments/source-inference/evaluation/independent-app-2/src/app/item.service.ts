import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, switchMap, tap } from 'rxjs';
import { Item, ItemInput } from './item.model';

@Injectable({ providedIn: 'root' })
export class ItemService {
  private resetSubject = new Subject<void>();
  readonly reseeded$ = this.resetSubject.asObservable();

  constructor(private http: HttpClient) {}

  list(): Observable<Item[]> {
    return this.http.get<Item[]>('/api/items');
  }

  get(id: string): Observable<Item> {
    return this.http.get<Item>(`/api/items/${id}`);
  }

  categories(): Observable<string[]> {
    return this.http.get<string[]>('/api/categories');
  }

  create(input: ItemInput): Observable<Item> {
    return this.http.post<Item>('/api/items', input);
  }

  update(id: string, changes: Partial<Item>): Observable<Item> {
    return this.http.put<Item>(`/api/items/${id}`, changes);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`/api/items/${id}`);
  }

  setArchived(item: Item, archived: boolean): Observable<Item> {
    return this.update(item.id, { ...item, archived });
  }

  adjustStock(id: string, delta: number): Observable<Item> {
    return this.get(id).pipe(
      switchMap(item => this.update(id, { ...item, quantity: Math.max(0, item.quantity + delta) })),
    );
  }

  duplicate(id: string): Observable<Item> {
    return this.get(id).pipe(
      switchMap(item =>
        this.create({
          name: `${item.name} (copy)`,
          sku: item.sku,
          quantity: item.quantity,
          category: item.category,
          perishable: item.perishable,
        }),
      ),
    );
  }

  resetDemo(): Observable<void> {
    return this.http.post<void>('/api/reset', {}).pipe(tap(() => this.resetSubject.next()));
  }
}

import { Injectable } from '@angular/core';
import { Contact } from './models';

const KEY = 'contacts';

@Injectable({ providedIn: 'root' })
export class ContactService {
  constructor() {
    if (!localStorage.getItem('app_seeded')) {
      const groups = ['Family', 'Friends', 'Work', 'Other'];
      const seed: Contact[] = Array.from({ length: 12 }, (_, i) => {
        const n = i + 1;
        const name = 'Person ' + String.fromCharCode(64 + n);
        return { id: 'c' + n, name, email: `person${n}@example.com`, phone: '555010' + String(n).padStart(2, '0'),
          group: groups[i % 4], favorite: false };
      });
      localStorage.setItem(KEY, JSON.stringify(seed));
      localStorage.setItem('settings', JSON.stringify({ compact: false, theme: 'light', showPhone: true }));
      localStorage.setItem('session', JSON.stringify({ user: 'demo' }));
      localStorage.setItem('app_seeded', '1');
    }
  }
  getAll(): Contact[] { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
  get(id: string): Contact | undefined { return this.getAll().find(c => c.id === id); }
  private save(list: Contact[]) { localStorage.setItem(KEY, JSON.stringify(list)); }
  add(c: Omit<Contact, 'id' | 'favorite'>): Contact {
    const created: Contact = { ...c, id: 'c' + Date.now(), favorite: false };
    this.save([...this.getAll(), created]);
    return created;
  }
  update(id: string, changes: Partial<Contact>) {
    this.save(this.getAll().map(c => (c.id === id ? { ...c, ...changes } : c)));
  }
  remove(id: string) { this.save(this.getAll().filter(c => c.id !== id)); }
  toggleFavorite(id: string) {
    const c = this.get(id);
    if (c) this.update(id, { favorite: !c.favorite });
  }
  clear() { this.save([]); }
}

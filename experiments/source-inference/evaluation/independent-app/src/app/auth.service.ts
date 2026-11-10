import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly user = signal<string | null>(this.read());
  private read(): string | null {
    try { return JSON.parse(localStorage.getItem('session') || 'null')?.user ?? null; } catch { return null; }
  }
  login(user: string) { localStorage.setItem('session', JSON.stringify({ user })); this.user.set(user); }
  logout() { localStorage.removeItem('session'); this.user.set(null); }
}

import { Injectable, signal } from '@angular/core';
import { Settings } from './models';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  readonly settings = signal<Settings>({ compact: false, theme: 'light', showPhone: true });
  constructor() {
    try { this.settings.set({ ...this.settings(), ...JSON.parse(localStorage.getItem('settings') || '{}') }); } catch {}
    this.applyTheme();
  }
  update(changes: Partial<Settings>) {
    this.settings.set({ ...this.settings(), ...changes });
    localStorage.setItem('settings', JSON.stringify(this.settings()));
    this.applyTheme();
  }
  private applyTheme() {
    document.body.classList.remove('theme-light', 'theme-dark');
    document.body.classList.add('theme-' + this.settings().theme);
  }
}

import { Component, inject } from '@angular/core';
import { MatSlideToggleChange, MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectChange, MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { SettingsService } from './settings.service';

@Component({
  selector: 'app-settings',
  imports: [MatSlideToggleModule, MatSelectModule, MatFormFieldModule],
  template: `
    <div class="page">
      <h2>Settings</h2>
      <mat-slide-toggle class="field" [checked]="s.settings().compact" (change)="onCompactChange($event)">Compact view</mat-slide-toggle>
      <mat-form-field class="field">
        <mat-label>Theme</mat-label>
        <mat-select [value]="s.settings().theme" (selectionChange)="onThemeChange($event)">
          @for (t of themes; track t) { <mat-option [value]="t">{{ t }}</mat-option> }
        </mat-select>
      </mat-form-field>
      <label class="field"><input type="checkbox" id="show-phone" [checked]="s.settings().showPhone" (change)="onShowPhoneChange($event)"> Show phone numbers</label>
    </div>`,
})
export class SettingsComponent {
  s = inject(SettingsService);
  themes = ['light', 'dark'];
  onCompactChange(e: MatSlideToggleChange) { this.s.update({ compact: e.checked }); }
  onThemeChange(e: MatSelectChange) { this.s.update({ theme: e.value }); }
  onShowPhoneChange(e: Event) { this.s.update({ showPhone: (e.target as HTMLInputElement).checked }); }
}

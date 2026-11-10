import { Component, computed, signal } from '@angular/core';

export type Range = 'week' | 'month';

@Component({
  selector: 'app-reports',
  template: `
    <div class="page">
      <h2>Reports</h2>
      <mat-button-toggle-group [value]="range()" (change)="setRange($event.value)" aria-label="Range">
        <mat-button-toggle value="week">Week</mat-button-toggle>
        <mat-button-toggle value="month">Month</mat-button-toggle>
      </mat-button-toggle-group>
      <p id="range-label">Showing: {{ label() }}</p>
      <button mat-raised-button color="primary" (click)="exportCsv()">Export CSV</button>
      @if (lastExport()) {
        <p id="last-export">Last export: {{ lastExport() }}</p>
      }
    </div>
  `,
  standalone: false,
})
export class ReportsComponent {
  range = signal<Range>('week');
  lastExport = signal<string | null>(null);
  label = computed(() => (this.range() === 'week' ? 'Last 7 days' : 'Last 30 days'));

  setRange(range: Range): void {
    this.range.set(range);
  }

  exportCsv(): void {
    const r = this.range();
    this.lastExport.set(r);
    localStorage.setItem('lastExport', r);
  }
}

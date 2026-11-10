import { Component } from '@angular/core';
import { ItemService } from './item.service';

@Component({
  selector: 'app-root',
  template: `
    <mat-toolbar color="primary">
      <button mat-button (click)="nav.toggle()">Menu</button>
      <span>Inventory</span>
      <span class="spacer"></span>
      <button mat-button (click)="resetDemo()">Reset demo data</button>
    </mat-toolbar>
    <mat-sidenav-container style="height: calc(100vh - 64px)">
      <mat-sidenav #nav mode="side" opened>
        <mat-nav-list>
          <a mat-list-item routerLink="/items" routerLinkActive="active">Items</a>
          <a mat-list-item routerLink="/reports" routerLinkActive="active">Reports</a>
        </mat-nav-list>
      </mat-sidenav>
      <mat-sidenav-content>
        <router-outlet></router-outlet>
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  standalone: false,
})
export class AppComponent {
  constructor(private items: ItemService) {}

  resetDemo(): void {
    this.items.resetDemo().subscribe();
  }
}

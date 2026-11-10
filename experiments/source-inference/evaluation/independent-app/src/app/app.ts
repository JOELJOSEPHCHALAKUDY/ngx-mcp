import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { AuthService } from './auth.service';
import { SettingsService } from './settings.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, MatToolbarModule, MatButtonModule, MatMenuModule],
  template: `
    <mat-toolbar color="primary">
      <span>Contacts</span>
      <a mat-button routerLink="/contacts">List</a>
      <a mat-button routerLink="/contacts/new">Add</a>
      <a mat-button routerLink="/settings">Settings</a>
      <span style="flex:1"></span>
      <span class="who">{{ auth.user() ?? 'signed out' }}</span>
      <button mat-button class="user-menu-trigger" [matMenuTriggerFor]="userMenu">Account</button>
      <mat-menu #userMenu="matMenu">
        <button mat-menu-item class="switch-user" (click)="switchUser()">Switch user</button>
        <button mat-menu-item class="sign-out" (click)="signOut()">Sign out</button>
      </mat-menu>
    </mat-toolbar>
    <router-outlet />
  `,
})
export class App {
  auth = inject(AuthService);
  private router = inject(Router);
  private settings = inject(SettingsService);
  signOut() { this.auth.logout(); this.router.navigate(['/login']); }
  switchUser() { this.auth.login(this.auth.user() === 'demo' ? 'guest' : 'demo'); }
}

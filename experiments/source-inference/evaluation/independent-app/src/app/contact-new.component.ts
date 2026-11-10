import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { ContactService } from './contact.service';
import { GROUPS } from './models';

@Component({
  selector: 'app-contact-new',
  imports: [FormsModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule],
  template: `
    <div class="page">
      <h2>New contact</h2>
      <form #f="ngForm" (ngSubmit)="onSubmit()">
        <mat-form-field class="field"><mat-label>Name</mat-label>
          <input matInput name="name" id="name" [(ngModel)]="model.name" required minlength="2"></mat-form-field>
        <mat-form-field class="field"><mat-label>Email</mat-label>
          <input matInput name="email" id="email" [(ngModel)]="model.email" required email></mat-form-field>
        <mat-form-field class="field"><mat-label>Phone</mat-label>
          <input matInput name="phone" id="phone" [(ngModel)]="model.phone" minlength="7"></mat-form-field>
        <mat-form-field class="field"><mat-label>Group</mat-label>
          <mat-select name="group" id="group" [(ngModel)]="model.group" required>
            @for (g of groups; track g) { <mat-option [value]="g">{{ g }}</mat-option> }
          </mat-select></mat-form-field>
        <button mat-flat-button type="submit" id="save-btn" [disabled]="f.invalid">Save</button>
      </form>
    </div>`,
})
export class ContactNewComponent {
  private svc = inject(ContactService);
  private router = inject(Router);
  groups = GROUPS;
  model = { name: '', email: '', phone: '', group: '' };
  onSubmit() {
    this.svc.add({ ...this.model });
    this.router.navigate(['/contacts']);
  }
}

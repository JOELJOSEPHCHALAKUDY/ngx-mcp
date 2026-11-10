import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <div class="page">
      <h2>Login</h2>
      <form [formGroup]="form" (ngSubmit)="onLogin()">
        <mat-form-field class="field"><mat-label>Username</mat-label><input matInput formControlName="username" id="username"></mat-form-field>
        <mat-form-field class="field"><mat-label>Password</mat-label><input matInput type="password" formControlName="password" id="password"></mat-form-field>
        <button mat-flat-button type="submit" id="login-btn" [disabled]="form.invalid">Login</button>
      </form>
    </div>`,
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);
  form = this.fb.nonNullable.group({ username: ['', Validators.required], password: ['', Validators.required] });
  onLogin() {
    if (this.form.invalid) return;
    this.auth.login(this.form.controls.username.value.trim());
    this.router.navigate(['/contacts']);
  }
}

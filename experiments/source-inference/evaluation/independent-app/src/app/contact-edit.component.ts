import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { ContactService } from './contact.service';
import { GROUPS } from './models';

@Component({
  selector: 'app-contact-edit',
  imports: [ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule],
  template: `
    <div class="page">
      <h2>Edit contact</h2>
      <form [formGroup]="form" (ngSubmit)="onSave()">
        <mat-form-field class="field"><mat-label>Name</mat-label><input matInput id="name" formControlName="name"></mat-form-field>
        <mat-form-field class="field"><mat-label>Email</mat-label><input matInput id="email" formControlName="email"></mat-form-field>
        <mat-form-field class="field"><mat-label>Phone</mat-label><input matInput id="phone" formControlName="phone"></mat-form-field>
        <mat-form-field class="field"><mat-label>Group</mat-label>
          <mat-select id="group" formControlName="group">
            @for (g of groups; track g) { <mat-option [value]="g">{{ g }}</mat-option> }
          </mat-select></mat-form-field>
        <mat-form-field class="field"><mat-label>Company (required for Work)</mat-label><input matInput id="company" formControlName="company"></mat-form-field>
        <button mat-flat-button type="submit" id="save-btn" [disabled]="form.invalid">Save</button>
      </form>
    </div>`,
})
export class ContactEditComponent implements OnInit {
  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private svc = inject(ContactService);
  groups = GROUPS;
  id = '';
  form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    phone: [''],
    group: ['Other'],
    company: [''],
  });
  ngOnInit() {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    const c = this.svc.get(this.id);
    if (c) this.form.patchValue({ name: c.name, email: c.email, phone: c.phone, group: c.group, company: c.company ?? '' });
    this.updateCompany(this.form.controls.group.value);
    this.form.controls.group.valueChanges.subscribe(g => this.updateCompany(g));
  }
  private updateCompany(group: string) {
    const ctl = this.form.controls.company;
    ctl.setValidators(group === 'Work' ? [Validators.required] : []);
    ctl.updateValueAndValidity();
  }
  onSave() {
    if (this.form.invalid) return;
    this.svc.update(this.id, this.form.getRawValue());
    this.router.navigate(['/contacts']);
  }
}

import { Routes } from '@angular/router';
import { ContactListComponent } from './contact-list.component';
import { ContactNewComponent } from './contact-new.component';
import { ContactEditComponent } from './contact-edit.component';
import { SettingsComponent } from './settings.component';
import { LoginComponent } from './login.component';
export const routes: Routes = [
  { path: '', redirectTo: 'contacts', pathMatch: 'full' },
  { path: 'contacts', component: ContactListComponent },
  { path: 'contacts/new', component: ContactNewComponent },
  { path: 'contacts/:id/edit', component: ContactEditComponent },
  { path: 'settings', component: SettingsComponent },
  { path: 'login', component: LoginComponent },
  { path: '**', redirectTo: 'contacts' },
];

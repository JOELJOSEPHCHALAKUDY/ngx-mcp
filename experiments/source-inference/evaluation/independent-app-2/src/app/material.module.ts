import { NgModule } from '@angular/core';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { MatSortModule } from '@angular/material/sort';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonToggleModule } from '@angular/material/button-toggle';

const MODULES = [
  MatToolbarModule, MatSidenavModule, MatListModule, MatButtonModule, MatTableModule,
  MatSortModule, MatTabsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
  MatSelectModule, MatCheckboxModule, MatButtonToggleModule,
];

@NgModule({ imports: MODULES, exports: MODULES })
export class MaterialModule {}

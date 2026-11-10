import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MaterialModule } from '../material.module';
import { ItemsRoutingModule } from './items-routing.module';
import { ItemsListComponent } from './items-list.component';
import { ItemDetailComponent } from './item-detail.component';
import { ItemDialogComponent } from './item-dialog.component';
import { ConfirmDialogComponent } from './confirm-dialog.component';

@NgModule({
  declarations: [ItemsListComponent, ItemDetailComponent, ItemDialogComponent, ConfirmDialogComponent],
  imports: [CommonModule, FormsModule, ReactiveFormsModule, MaterialModule, ItemsRoutingModule],
})
export class ItemsModule {}

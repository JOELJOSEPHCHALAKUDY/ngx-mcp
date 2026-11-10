import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ItemsListComponent } from './items-list.component';
import { ItemDetailComponent } from './item-detail.component';

const routes: Routes = [
  { path: '', component: ItemsListComponent },
  { path: ':id', component: ItemDetailComponent },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ItemsRoutingModule {}

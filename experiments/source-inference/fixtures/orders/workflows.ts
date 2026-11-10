import {Component,Injectable,inject,linkedSignal} from '@angular/core';

declare function form(model:unknown,schema:(path:any)=>void):any;
declare function required(path:any):void;
declare function minLength(path:any,length:number):void;
declare function maxLength(path:any,length:number):void;
declare function applyEach(path:any,schema:(item:any)=>void):void;

@Injectable({providedIn:'root'})
export class WorkflowService {
  async save(record:{name:string;category:string;lessons:{name:string;url:string}[]}):Promise<string>{return record.name;}
}
@Component({selector:'signal-example',standalone:true,template:`
 <form class="editor" (submit)="save()">
  <mat-form-field><mat-label>Name</mat-label><input [formField]="editor.name"></mat-form-field>
  <mat-form-field><mat-label>Category</mat-label><mat-select [formField]="editor.category"><mat-option value="A">Category A</mat-option></mat-select></mat-form-field>
  <section class="add-row"><button type="button" (click)="add()">Add lesson</button></section>
  @for (row of editor.lessons; track $index) {
   <div class="lesson"><mat-form-field><mat-label>Lesson name</mat-label><input [formField]="row.name"></mat-form-field>
   <mat-form-field><mat-label>URL</mat-label><input [formField]="row.url"></mat-form-field><button class="remove" type="button" (click)="remove($index)">Remove</button></div>
  }
 </form>
 <button type="submit" (click)="save()">Save</button>
`})
export class SignalExample {
  private service=inject(WorkflowService);
  private model=linkedSignal(()=>({name:'',category:'',lessons:[{name:'',url:''}]}));
  editor=form(this.model,path=>{
    required(path.name);minLength(path.name,5);maxLength(path.name,80);required(path.category);minLength(path.lessons,1);
    applyEach(path.lessons,row=>{required(row.name);minLength(row.name,3);required(row.url);});
  });
  protected add(){this.model.update(model=>({...model,lessons:[...model.lessons,{name:'',url:''}]}));}
  protected remove(index:number){this.model.update(model=>({...model,lessons:model.lessons.filter((_,i)=>i!==index)}));}
  protected save(){return this.service.save(this.model());}
}

@Component({selector:'draft-example',standalone:true,template:'<div [formGroup]="profile"><input formControlName="title"></div>'})
export class DraftExample {
  profile={valueChanges:{subscribe(callback:(value:{title:string})=>void){}}};
  ngOnInit(){this.profile.valueChanges.subscribe(value=>localStorage.setItem('example-draft',JSON.stringify(value)));}
}
@Component({selector:'shadow-storage',standalone:true,template:'<div [formGroup]="profile"><input formControlName="title"></div>'})
export class ShadowStorage {
  profile={valueChanges:{subscribe(callback:(value:{title:string})=>void){}}};
  ngOnInit(){const localStorage={setItem(key:string,value:string){}};this.profile.valueChanges.subscribe(value=>localStorage.setItem('fake',JSON.stringify(value)));}
}

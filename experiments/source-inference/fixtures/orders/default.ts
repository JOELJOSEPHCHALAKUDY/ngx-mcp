import {Component,inject,Service} from '@angular/core';
@Service()
export class NewService { read():string {return 'example';} }
@Component({standalone:true,template:'<form (ngSubmit)="load()"><input name="secret" type="password"><input name="consent" type="checkbox"><button type="submit">Load</button></form>'})
export default class SelectorlessPage {
  private service=inject(NewService);
  protected load(){return this.service.read();}
}

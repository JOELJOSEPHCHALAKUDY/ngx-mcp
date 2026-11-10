import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {Ajv} from 'ajv';
import {compile} from '../src/compiler.js';

const directory=mkdtempSync(resolve(tmpdir(),'angular-factory-injection-'));
after(()=>rmSync(directory,{recursive:true,force:true}));
symlinkSync(resolve('node_modules'),resolve(directory,'node_modules'),'dir');
writeFileSync(resolve(directory,'app.ts'),`
import {Component,Injectable,NgModule,inject,Inject,importProvidersFrom} from '@angular/core';
function createStore(){return class GeneratedStore {
 count=0;
 save=({name}:{name:string})=>{this.count++;return {name};};
 clear(){this.count=0;}
 private hidden(){this.count=-1;}
};}
const FactoryStore=createStore();
declare function dynamicFactory():any;
const UnknownStore:any=dynamicFactory();
@Component({selector:'factory-page',providers:[FactoryStore],template:'<button id="save" (click)="save()">Save</button><button id="direct" (click)="store.clear()">Clear</button><button id="hidden" (click)="hidden()">Hidden</button>'})
export class FactoryPage {
 store=inject(FactoryStore);
 save(){this.store.save({name:'Example'});}
 hidden(){this.store.hidden();}
}
@Component({selector:'constructor-page',providers:[FactoryStore],template:'<button (click)="save()">Save</button>'})
export class ConstructorPage {
 constructor(@Inject(FactoryStore) private store:InstanceType<typeof FactoryStore>){}
 save(){this.store.save({name:'Example'});}
}
@Component({selector:'uncertain-page',providers:[{provide:FactoryStore,useFactory:dynamicFactory}],template:'<button (click)="save()">Save</button>'})
export class UncertainPage {store=inject(FactoryStore);save(){this.store.save({name:'Example'});}}
@Component({selector:'unknown-page',template:'<button (click)="save()">Save</button>'})
export class UnknownPage {store=inject(UnknownStore);save(){this.store.save({name:'Example'});}}
@Injectable() export class Api {save(){return 'base';}}
@Injectable() export class AlternateApi {save(){return 'alternate';}}
const SHARED_PROVIDERS=[{provide:Api,useClass:AlternateApi}];
@NgModule({providers:[SHARED_PROVIDERS]}) export class DataModule {}
@Component({selector:'module-page',template:'<button (click)="save()">Save</button>'})
export class ModulePage {constructor(private api:Api){}save(){this.api.save();}}
export const routes=[
{path:'factory',component:FactoryPage},{path:'constructor',component:ConstructorPage},{path:'uncertain',component:UncertainPage},{path:'unknown',component:UnknownPage},
{path:'module',providers:[importProvidersFrom(DataModule)],component:ModulePage},
{path:'array',providers:[SHARED_PROVIDERS],component:ModulePage},
{path:'dynamic',providers:[{provide:Api,useFactory:dynamicFactory}],component:ModulePage}];
`);
writeFileSync(resolve(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ES2022',moduleResolution:'bundler',experimentalDecorators:true,skipLibCheck:true,types:[]},include:['app.ts']}));
const manifest=compile(resolve(directory,'tsconfig.json'),'app.ts#routes');
const get=(route:string,handler:string)=>manifest.capabilities.find(c=>c.route===route&&c.handler===handler);
test('constructor-valued injected factories resolve arrow and class methods to authored source',()=>{
 const save=get('/factory','save');assert(save);assert.equal(save.status,'candidate');
 const binding=save.bindings.find(b=>b.method==='save');assert(binding);assert.equal(binding.token,'FactoryStore');assert.equal(binding.service,'FactoryStore');
 const validate=new Ajv({strict:false}).compile(binding.inputSchema);assert(validate({arg0:{name:'Example'}}));assert(!validate({arg0:{name:3}}));
 assert(!manifest.capabilities.some(c=>c.bindings.some(b=>b.method==='hidden')));
});
test('explicit Inject supports constructor parameters whose token is a typed factory',()=>{
 assert(get('/constructor','save')?.bindings.some(b=>b.token==='FactoryStore'&&b.method==='save'));
});
test('direct injected receiver actions bind the checked factory method',()=>{
 const clear=get('/factory','store.clear');assert(clear);assert.equal(clear.status,'candidate');assert(clear.bindings.some(b=>b.method==='clear'));
});
test('unproven factory return types and dynamic factory overrides stay unexposed or blocked',()=>{
 assert(!get('/unknown','save'));
 assert.equal(get('/uncertain','save')?.status,'blocked');
 assert.equal(get('/dynamic','save')?.status,'blocked');
});
test('imported nested provider arrays and local NgModule providers retain static overrides',()=>{
 for(const route of ['/array','/module']){const save=get(route,'save');assert(save);assert.equal(save.status,'candidate');assert.equal(save.bindings[0].service,'AlternateApi');}
});

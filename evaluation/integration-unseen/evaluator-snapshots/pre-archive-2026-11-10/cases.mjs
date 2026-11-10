import assert from 'node:assert/strict';
import {assertPayloadState} from './oracles.mjs';
import {labels,nativeDriver,delay,snapshot,confirmation,loginShopping,financeInit,financeTransaction,financeCategory,financeBudget,financeMenu,todoCreate} from './fixtures.mjs';
const seedTx={...labels('finance').operations.find(x=>x.id==='transaction-create').validInput,description:'Unseen seed transaction'};
const seedCat={...labels('finance').operations.find(x=>x.id==='category-create').validInput,name:'Unseen existing'};
export async function prepare(page,baseUrl,project,op,negative,api){const d=nativeDriver(page),meta={};
 if(project==='finance'){
  await financeInit(page,baseUrl);meta.defaultCategories=(await snapshot(page,project)).categories;
  if(['transaction-edit','transaction-delete','transaction-undo','transactions-export','data-clear','data-restore-demo'].includes(op.id)||negative?.id==='used-category-delete'){await financeTransaction(page,baseUrl,seedTx);meta.transaction=(await snapshot(page,project)).transactions[0];if(['transaction-edit','transaction-delete','transaction-undo'].includes(op.id))await financeTransaction(page,baseUrl,{...seedTx,description:'Unseen untouched transaction',amount:9.5});}
  if(['category-edit','category-delete'].includes(op.id)||negative?.id==='duplicate-category'){await financeCategory(page,baseUrl,seedCat);meta.category=(await snapshot(page,project)).categories.find(x=>x.name===seedCat.name);}
  if(['budget-remove','category-delete'].includes(op.id))await financeBudget(page,baseUrl,55.5);if(op.id==='category-delete'){await page.goto(baseUrl+'/orcamentos');await d.activate(page.locator('button.chip').filter({hasText:seedCat.name}));await financeBudget(page,baseUrl,44.4,d,false);}
  if(op.id.startsWith('transaction-')&&op.id!=='transaction-create'){
   await page.goto(baseUrl+'/transacoes');const row=page.locator('tr[mat-row]').filter({hasText:seedTx.description});if(op.id==='transaction-delete')await d.activate(row.locator('button').filter({has:page.locator('mat-icon',{hasText:'more_vert'})}));else await financeMenu(page,d,row,op.id==='transaction-edit'?'Edit':'Delete');
   if(op.id==='transaction-undo')await confirmation(page,d);
  }else if(op.id.startsWith('category-')&&op.id!=='category-create'){
   await page.goto(baseUrl+'/categorias');const name=negative?.id==='used-category-delete'?'Food':seedCat.name;const row=page.locator('li.card').filter({hasText:name});if(op.id==='category-delete')await d.activate(row.locator('button').filter({has:page.locator('mat-icon',{hasText:'more_vert'})}));else await financeMenu(page,d,row,'Edit');
  }else if(op.id==='budget-remove'){
   await page.goto(baseUrl+'/orcamentos');await d.activate(page.locator('app-budget-row').filter({hasText:'Food'}).locator('button'));
  }else if(op.id.startsWith('transactions-')||op.id.startsWith('data-'))await page.goto(baseUrl+'/configuracoes');
 }else if(project==='todo'){
  await page.goto(baseUrl+'/');await page.getByRole('button',{name:'Add new task',exact:true}).waitFor();
  if(op.id==='todo-create')await todoCreate(page,{title:'Unseen neighbor task',description:'Independent untouched neighbor'});
  if(op.id!=='todo-create'){
   await todoCreate(page,{title:'Unseen task',description:'Independent source fixture'});meta.todo=(await snapshot(page,project))[0];
   await todoCreate(page,{title:'Unseen neighbor task',description:'Independent untouched neighbor'});
   if(['todo-restore','todo-delete-completed'].includes(op.id)){await d.activate(page.locator('mat-card').filter({has:page.locator('mat-card-title').filter({hasText:/^\s*Unseen task\s*$/})}).getByRole('button',{name:'Complete Task',exact:true}));await page.getByRole('tab',{name:'Completed',exact:true}).click();}
  }
 }else{
  if(!['session-login','account-register','account-confirm'].includes(op.id))await loginShopping(page,baseUrl);
  if(op.id==='article-unbuy'||op.id==='articles-archive')await d.activate(page.locator('app-home div.flex.my-1').filter({hasText:'Unseen milk'}).locator('p-checkbox'));
  const route=op.routes[0].replace(':einkaufszettelId','101').replace(':artikelId','201');
  if(op.id==='account-confirm')await page.goto(baseUrl+'/login');else if(['article-edit','article-delete'].includes(op.id)){await page.locator('app-home').waitFor();await page.locator('app-home span[ptooltip="Artikel bearbeiten"]').filter({hasText:'Unseen milk'}).click();await page.locator('app-edit-artikel input[formControlName=name]').waitFor();}else await page.goto(baseUrl+route);
  if(op.id==='admin-user-save'){await page.locator('app-user tr').filter({hasText:'unseen-member'}).locator('button[pInitEditableRow]').click();if(negative?.expected==='ambiguous-target-refused')await page.locator('app-user tr').filter({hasText:'unseen-admin'}).locator('button[pInitEditableRow]').click();await delay(page);}
  if(op.id==='session-logout'){await d.activate(page.locator('nav .image-container'));}
 }
 return meta;
}
export async function act(page,baseUrl,project,op,args,driver,negative){
 const id=op.id;
 if(negative?.expected==='ambiguous-target-refused')return driver.ambiguous?.(project,op);
 if(project==='finance'){
  if(id==='transaction-create'||id==='transaction-edit')return financeTransaction(page,baseUrl,args,driver,id==='transaction-create');
  if(id==='transaction-delete'){await driver.activate(page.getByRole('menuitem',{name:'Delete',exact:true}));return confirmation(page,driver,negative?.decision!=='reject');}
  if(id==='transaction-undo')return driver.activate(page.locator('mat-snack-bar-container').getByRole('button',{name:'Undo',exact:true}));
  if(id==='category-create'||id==='category-edit')return financeCategory(page,baseUrl,args,driver,id==='category-create');
  if(id==='category-delete'){await driver.activate(page.getByRole('menuitem',{name:'Delete',exact:true}));if(await page.locator('app-confirm-dialog').count())return confirmation(page,driver,negative?.decision!=='reject');return;}
  if(id==='budget-set')return financeBudget(page,baseUrl,args.limit,driver);
  if(id==='budget-remove')return driver.activate(page.locator('app-budget-dialog button.remove'));
  if(id==='transactions-import')return driver.file(page.locator('#csv-file'),args.file);
  if(id==='transactions-export'){const download=page.waitForEvent('download',{timeout:2500});await driver.activate(page.getByRole('button',{name:'Export transactions',exact:true}));return download;}
  if(id==='data-clear'||id==='data-restore-demo'){await driver.activate(page.locator('app-settings-page').getByRole('button',{name:id==='data-clear'?'Clear data':'Restore demo data',exact:true}));return confirmation(page,driver);}
 }else if(project==='todo'){
  if(id==='todo-create')return todoCreate(page,args,driver);
  return driver.activate(page.locator('mat-card').filter({has:page.locator('mat-card-title').filter({hasText:/^\s*Unseen task\s*$/})}).getByRole('button',{name:id==='todo-complete'?'Complete Task':id==='todo-restore'?'Restore Task':'Delete Task',exact:true}));
 }else{
  if(id==='account-confirm')return driver.navigate?.('/registration-confirmation?token=synthetic-unseen-confirm-token')??page.goto(baseUrl+'/registration-confirmation?token=synthetic-unseen-confirm-token');
  if(['session-login','account-register','list-create','list-edit','article-create','article-edit','profile-save'].includes(id)){
   const f=page.locator('router-outlet+* form');await f.waitFor();const fields=[];
   for(const[name,value]of Object.entries(args)){
    if(Array.isArray(value)){await driver.custom(f.locator(`[formControlName="${name}"]`),value);continue;}
    let locator=f.locator(`[formControlName="${name}"]`);if(name==='password'||name==='anzahl')locator=locator.locator('input');
    fields.push({locator,value});
   }
   return driver.submit(f,fields);
  }
  if(['list-delete','article-delete'].includes(id)){await driver.activate(page.getByRole('button',{name:'Löschen',exact:true}));return confirmation(page,driver,negative?.decision!=='reject');}
  if(id==='article-buy')return driver.activate(page.locator('app-home div.flex.my-1').filter({hasText:'Unseen milk'}).locator('p-checkbox'));
  if(id==='article-unbuy')return driver.activate(page.locator('app-home div.flex.my-1').filter({hasText:'Unseen milk'}).locator('span.fa-check'));
  if(id==='articles-archive'){await driver.activate(page.locator('app-home .flex-grow-1').filter({has:page.locator('h2').filter({hasText:'Unseen fixture list'})}).locator('app-split-button #options-menu'));return driver.activate(page.locator('button[role=menuitem]').filter({hasText:'Gekaufte Artikel archivieren'}));}
  if(id==='session-logout'){await driver.activate(page.locator('li').filter({hasText:'Ausloggen'}));return confirmation(page,driver);}
  if(id==='admin-user-save'){
   const row=page.locator('app-user tr').filter({has:page.locator('input')});for(const[name,value]of Object.entries(args)){if(name==='roles'){if(driver.custom)await driver.custom(row.locator('p-multiSelect'),value,{optionLabels:value.map(id=>({1:'ROLE_ADMIN',2:'ROLE_USER'})[id]),modelIdentityPath:['id'],identityLabels:[{identity:1,label:'ROLE_ADMIN'},{identity:2,label:'ROLE_USER'}]});continue;}const index=['username','name','email'].indexOf(name);await driver.fill(row.locator('input[type=text]').nth(index),value);}
   return driver.activate(row.locator('button[pSaveEditableRow]'));
  }
  if(id==='admin-user-delete'){await driver.activate(page.locator('app-user tr').filter({hasText:'unseen-member'}).locator('button.fa-trash'));return confirmation(page,driver);}
  if(id==='profile-avatar'){await driver.file(page.locator('app-avatar input[type=file]'),args.file);await page.locator('.cropper-crop-box').waitFor({timeout:2000});await page.waitForTimeout(600);return driver.activate(page.locator('app-image-cropper button').filter({hasText:'Ok'}));}
 }
 throw new Error('No independent source UI action definition for '+project+'/'+id);
}
export async function verify(page,project,op,args,before,after,meta,negative,result){
 if(negative){
  if(negative.expected==='ambiguous-target-refused')return {protocolBoundary:true};
  assert.deepEqual(after,before,'Rejected source input changed domain state');if(negative.id==='used-category-delete')assert((await page.locator('mat-snack-bar-container').innerText()).toLowerCase().includes('before removing the category'),'Source in-use rejection notification missing');
  if(negative.decision!=='reject'&&!['used-category-delete','malformed-import'].includes(negative.id))assert(await page.locator('.ng-invalid, [aria-invalid=true],button:disabled,[role=alert]').count()>0,'Invalid source UI evidence missing');
  if(negative.id==='duplicate-category')return {unchanged:true,feedback:await page.locator('app-category-form-dialog [role=alert]').innerText(),rejectionKind:'source-group-validator'};
  return {unchanged:true,...negative.id==='used-category-delete'?{feedback:await page.locator('mat-snack-bar-container').innerText(),rejectionKind:'source-app'}:negative.id==='malformed-import'?{feedback:await page.locator('app-settings-page [role=alert]').innerText(),rejectionKind:'source-app'}: {}};
 }
 const oracle=assertPayloadState(project,op.id,args,before,after,meta);
 if(project==='finance'&&op.id==='transactions-export'){
  assert(result,'Download missing');const stream=await result.createReadStream();let csv='';for await(const chunk of stream)csv+=chunk;
  oracle.csvExport={text:csv};
  const rows=before.transactions.slice().sort((a,b)=>a.date.localeCompare(b.date)||a.createdAt.localeCompare(b.createdAt));
  assert.equal(csv.replace(/^\uFEFF/,'').trim(),['date,description,amount,type,category,notes',...rows.map(t=>[t.date,t.description,(t.amountCents/100).toFixed(2),t.type,before.categories.find(c=>c.id===t.categoryId).name,t.notes??''].join(','))].join('\r\n').trim());
 }
 if(project==='shopping'){
  if(op.id==='session-login')assert.equal(new URL(page.url()).pathname,'/home');
  if(op.id==='session-logout')assert.equal(new URL(page.url()).pathname,'/login');
  if(op.id==='account-confirm')assert((await page.locator('app-registration-confirmation').innerText()).includes('erfolgreich bestätigt'));
 }
 return oracle;
}

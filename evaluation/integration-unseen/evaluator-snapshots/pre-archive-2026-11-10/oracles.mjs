import assert from 'node:assert/strict';
export const payloadTransaction=args=>({type:args.type,description:args.description.trim(),amountCents:Math.round(args.amount*100),date:args.date,categoryId:args.categoryId,notes:(args.notes??'').trim()});
export function exactFields(actual,expected,message='Frozen payload field differs'){assert(actual,'Expected business record missing');for(const[key,value]of Object.entries(expected))assert.deepEqual(actual[key],value,message+': '+key);}
const other=(rows,id)=>rows.filter(row=>row.id!==id);
export function assertPayloadState(project,id,args,before,after,meta={}){
 if(project==='finance'){
  assert(after&&Array.isArray(after.transactions));assert.equal(after.version,before.version);
  if(id==='transaction-create'||id==='transaction-edit'){
   const t=id==='transaction-edit'?after.transactions.find(x=>x.id===meta.transaction.id):after.transactions.find(x=>!before.transactions.some(y=>y.id===x.id));exactFields(t,payloadTransaction(args));assert(t.id&&t.createdAt);
   assert.equal(after.transactions.length,before.transactions.length+(id==='transaction-create'?1:0));
   if(id==='transaction-edit')assert.equal(t.createdAt,meta.transaction.createdAt);
   assert.deepEqual(other(after.transactions,t.id),other(before.transactions,t.id));
  }
  if(id==='transaction-delete')assert.deepEqual(after.transactions,other(before.transactions,meta.transaction.id));
  if(id==='transaction-undo'){assert.equal(after.transactions.length,before.transactions.length+1);assert.deepEqual(after.transactions.find(x=>x.id===meta.transaction.id),meta.transaction);assert.deepEqual(other(after.transactions,meta.transaction.id),before.transactions);}
  if(id==='category-create'||id==='category-edit'){
   const c=id==='category-edit'?after.categories.find(x=>x.id===meta.category.id):after.categories.find(x=>!before.categories.some(y=>y.id===x.id));exactFields(c,{...args,name:args.name.trim()});assert.equal(after.categories.length,before.categories.length+(id==='category-create'?1:0));assert.deepEqual(other(after.categories,c.id),other(before.categories,c.id));
  }
  if(id==='category-delete'){assert.deepEqual(after.categories,other(before.categories,meta.category.id));assert(before.budgets.some(x=>x.categoryId===meta.category.id));assert.deepEqual(after.budgets,before.budgets.filter(x=>x.categoryId!==meta.category.id));}
  if(id==='budget-set'){exactFields(after.budgets.find(x=>x.categoryId==='cat-food'),{categoryId:'cat-food',limitCents:Math.round(args.limit*100)});assert.deepEqual(after.budgets.filter(x=>x.categoryId!=='cat-food'),before.budgets.filter(x=>x.categoryId!=='cat-food'));}
  if(id==='budget-remove')assert.deepEqual(after.budgets,before.budgets.filter(x=>x.categoryId!=='cat-food'));
  if(id==='transactions-import'){
   const row=args.file.text.trim().split(/\r?\n/)[1].split(';'),[date,description,amount,type,name,notes]=row;assert.equal(after.transactions.length,before.transactions.length+1);const category=after.categories.find(x=>x.name===name);exactFields(category,{name,type:type==='despesa'?'expense':'income',color:'#5f7d8c',icon:type==='despesa'?'sell':'savings'});const t=after.transactions.find(x=>!before.transactions.some(y=>y.id===x.id));exactFields(t,{date,description,amountCents:Math.round(Number(amount.replace(',','.'))*100),type:category.type,categoryId:category.id,notes});assert.deepEqual(other(after.transactions,t.id),before.transactions);assert.deepEqual(other(after.categories,category.id),before.categories);
  }
  if(id==='data-clear'){assert.deepEqual(after.transactions,[]);assert.deepEqual(after.budgets,[]);assert.deepEqual(after.categories,meta.defaultCategories);}
  if(id==='data-restore-demo'){assert(after.transactions.length>1);assert(!after.transactions.some(x=>x.description==='Unseen seed transaction'));assert.deepEqual(after.categories,meta.defaultCategories);assert(after.transactions.every(t=>after.categories.some(c=>c.id===t.categoryId)&&Number.isInteger(t.amountCents)&&t.amountCents>0));}
  if(!['category-create','category-edit','category-delete','transactions-import','data-clear','data-restore-demo'].includes(id))assert.deepEqual(after.categories,before.categories);
  if(!['transaction-create','transaction-edit','transaction-delete','transaction-undo','transactions-import','data-clear','data-restore-demo'].includes(id))assert.deepEqual(after.transactions,before.transactions);
  if(!['budget-set','budget-remove','category-delete','data-clear','data-restore-demo'].includes(id))assert.deepEqual(after.budgets,before.budgets);
 }else if(project==='todo'){
  if(id==='todo-create'){assert.equal(after.length,(before??[]).length+1);assert.deepEqual(after.slice(0,-1),before??[]);exactFields(after.at(-1),{id:Math.max(0,...(before??[]).map(x=>x.id))+1,...args,done:false});}
  if(id==='todo-complete'||id==='todo-restore'){assert.equal(after.length,before.length);assert.deepEqual(after.find(x=>x.id===meta.todo.id),{...before.find(x=>x.id===meta.todo.id),done:id==='todo-complete'});assert.deepEqual(other(after,meta.todo.id),other(before,meta.todo.id));}
  if(id.startsWith('todo-delete'))assert.deepEqual(after,other(before,meta.todo.id));
 }else{
  const state=after.domain,previous=before.domain;
  if(id==='session-login'){const user=JSON.parse(after.user);exactFields(user,{username:args.username,password:args.password});assert.equal(user.id,1);assert(user.token);assert.deepEqual(state,previous);}
  if(id==='account-register'){const u=state.users.find(x=>!previous.users.some(y=>y.id===x.id));exactFields(u,args);assert.equal(state.users.length,previous.users.length+1);assert.deepEqual(other(state.users,u.id),previous.users);}
  if(id==='session-logout'){assert.equal(after.user,'null');assert.deepEqual(state,previous);}
  if(id==='account-confirm'){assert.deepEqual(state.confirmations,[...previous.confirmations,'synthetic-unseen-confirm-token']);}
  if(id==='list-create'||id==='list-edit'){const list=id==='list-create'?state.lists.find(x=>!previous.lists.some(y=>y.id===x.id)):state.lists.find(x=>x.id===101);assert(list);assert.equal(list.name,args.name);for(const key of ['owners','sharedWith'])assert.deepEqual(list[key].map(x=>x.id),args[key]);assert.equal(state.lists.length,previous.lists.length+(id==='list-create'?1:0));assert.deepEqual(other(state.lists,list.id),other(previous.lists,list.id));assert.deepEqual(list.artikels,id==='list-create'?[]:previous.lists.find(x=>x.id===101).artikels);}
  if(id==='list-delete')assert.deepEqual(state.lists,other(previous.lists,101));
  if(id.startsWith('article-')||id==='articles-archive'){
   const list=state.lists.find(x=>x.id===101),old=previous.lists.find(x=>x.id===101);assert.deepEqual(other(state.lists,101),other(previous.lists,101));exactFields(list,{id:old.id,name:old.name,owners:old.owners,sharedWith:old.sharedWith});
   if(id==='article-create'||id==='article-edit'){const a=id==='article-create'?list.artikels.find(x=>!old.artikels.some(y=>y.id===x.id)):list.artikels.find(x=>x.id===201);exactFields(a,{...args,gekauft:id==='article-create'?false:old.artikels.find(x=>x.id===201).gekauft});assert.equal(list.artikels.length,old.artikels.length+(id==='article-create'?1:0));assert.deepEqual(other(list.artikels,a.id),other(old.artikels,a.id));}
   if(id==='article-delete')assert.deepEqual(list.artikels,other(old.artikels,201));
   if(id==='article-buy'||id==='article-unbuy'){assert.deepEqual(list.artikels,old.artikels.map(x=>x.id===201?{...x,gekauft:id==='article-buy'}:x));}
   if(id==='articles-archive'){assert.deepEqual(state.archived,[...previous.archived,...old.artikels.filter(x=>x.gekauft)]);assert.deepEqual(list.artikels,old.artikels.filter(x=>!x.gekauft));}
  }
  if(id==='profile-save'){assert.deepEqual(state.users.find(x=>x.id===1),{...previous.users.find(x=>x.id===1),...args,avatar:'',avatarBase64:''});assert.deepEqual(other(state.users,1),other(previous.users,1));}
  if(id==='profile-avatar'){assert(state.users[0].avatarBase64?.startsWith('data:image/jpeg;base64,'));assert.deepEqual(other(state.users,1),other(previous.users,1));}
  if(id==='admin-user-save'){const user=state.users.find(x=>x.id===2);exactFields(user,{username:args.username,name:args.name,email:args.email});assert.deepEqual(user.roles.map(x=>x.id),args.roles);assert.deepEqual({...user,roles:undefined},{...previous.users.find(x=>x.id===2),...args,roles:undefined});assert.deepEqual(other(state.users,2),other(previous.users,2));}
  if(id==='admin-user-delete')assert.deepEqual(state.users,other(previous.users,2));
  if(!['account-register','profile-save','profile-avatar','admin-user-save','admin-user-delete'].includes(id))assert.deepEqual(state.users,previous.users);
  if(!id.startsWith('list-')&&!id.startsWith('article-')&&id!=='articles-archive')assert.deepEqual(state.lists,previous.lists);
  if(id!=='articles-archive')assert.deepEqual(state.archived,previous.archived);
  if(id!=='account-confirm')assert.deepEqual(state.confirmations,previous.confirmations);
 }
 return {businessEffect:true,payloadVerified:true};
}

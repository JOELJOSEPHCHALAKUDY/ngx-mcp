export const base='http://127.0.0.1:4342';
export const seedTodos=[{title:'Read fixture article',completed:false},{title:'Clean fixture inbox',completed:false},{title:'Reserve fixture table',completed:true}];
export async function installIsolation(page){
 const network={blocked:[],apiRequests:[]};
 await page.route('**/*',async route=>{const request=route.request();const url=new URL(request.url());if(url.origin!==base){network.blocked.push(request.url());await route.abort('blockedbyclient');}else{if(/\/api\//.test(url.pathname))network.apiRequests.push({method:request.method(),url:request.url()});await route.continue();}});
 return network;
}
export async function seedThroughUi(page){
 await page.goto(base+'/#/all',{waitUntil:'networkidle'});
 await page.locator('input.new-todo').waitFor();
 for(const todo of seedTodos){await page.locator('.new-todo').fill(todo.title);await page.locator('.new-todo').press('Enter');}
 await page.locator('app-todo-item').filter({hasText:seedTodos[2].title}).locator('input.toggle').check();
}
export async function snapshot(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));return {url:page.url(),rows:await page.locator('app-todo-item li').evaluateAll(rows=>rows.map(row=>({title:row.querySelector('label').textContent,completed:row.querySelector('input.toggle').checked,editing:row.classList.contains('editing')}))),activeCount:await page.locator('.todo-count strong').textContent().catch(()=>null),input:await page.locator('.new-todo').inputValue()};}

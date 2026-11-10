export const seedTodos = [
  {id: 1, title: 'Read fixture article', complete: false},
  {id: 2, title: 'Clean fixture inbox', complete: false},
  {id: 3, title: 'Reserve fixture table', complete: true},
];
export async function installFixture(page) {
  const state = {todos: structuredClone(seedTodos), calls: [], nextId: 4};
  await page.route('http://localhost:3000/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = request.postData() ? JSON.parse(request.postData()) : null;
    state.calls.push({method, url: request.url(), body});
    const id = Number(url.pathname.split('/')[2]);
    let response;
    let status = 200;
    if (method === 'GET' && url.pathname === '/todos') response = state.todos;
    else if (method === 'POST' && url.pathname === '/todos') {
      response = {...body, id: state.nextId++}; state.todos.push(response); status = 201;
    } else if (method === 'PUT' && id) {
      response = {...body, id}; state.todos = state.todos.map(todo => todo.id === id ? response : todo);
    } else if (method === 'DELETE' && id) {
      state.todos = state.todos.filter(todo => todo.id !== id); response = {};
    } else {status = 404; response = {error: 'Unimplemented synthetic API route'};}
    await route.fulfill({status, contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: JSON.stringify(response)});
  });
  return state;
}

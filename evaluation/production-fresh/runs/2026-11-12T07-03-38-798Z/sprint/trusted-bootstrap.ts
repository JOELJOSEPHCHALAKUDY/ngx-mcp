
export async function connectNgxMcpAccess(){
 const request=async(path:string,input?:unknown)=>{const response=await fetch('/__ngx_access/'+path,{method:input===undefined?'GET':'POST',credentials:'same-origin',headers:input===undefined?undefined:{'content-type':'application/json'},body:input===undefined?undefined:JSON.stringify(input)});if(!response.ok)throw new Error('Trusted access service refused the request');return response.json();};
 const session=await request('session');
 return {session,validateSession:async()=>{try{return await request('session');}catch{return null;}},authorize:async(input:any)=>{try{return(await request('authorize',{operation:input.operation,sourceId:input.sourceId})).allowed===true;}catch{return false;}},approve:async(challenge:any)=>{try{return(await request('approval',challenge)).approved===true;}catch{return false;}},audit:async(event:any)=>{await request('audit',event);},origin:()=>location.origin,route:()=>location.pathname};
}

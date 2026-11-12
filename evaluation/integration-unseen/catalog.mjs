/** Read all current pages; callers must rediscover after UI mutations. No DOM or app-specific mappings. */
export async function listCatalog(call,filters={}){
 const nodes=[],identities=new Set();let offset=0,total;
 for(let page=0;page<201;page++){
  const result=await call('angular_list_nodes',{...filters,limit:500,offset});
  if(!Array.isArray(result?.nodes)||!Number.isSafeInteger(result.total)||result.total<0||result.total>100000||result.offset!==offset)throw new Error('Invalid catalog page');
  if(total!==undefined&&result.total!==total)throw new Error('Catalog changed during pagination; rediscover the current UI');total=result.total;
  for(const node of result.nodes){if(typeof node.instanceId!=='string'||identities.has(node.instanceId))throw new Error('Duplicate or missing catalog identity');identities.add(node.instanceId);nodes.push(node);}
  if(result.nextOffset==null){if(nodes.length!==total)throw new Error('Incomplete catalog pagination');return {...result,nodes,offset:0,nextOffset:null};}
  if(!Number.isSafeInteger(result.nextOffset)||result.nextOffset<=offset||result.nextOffset>total)throw new Error('Catalog pagination did not advance');offset=result.nextOffset;
 }
 throw new Error('Catalog pagination exceeded its budget');
}

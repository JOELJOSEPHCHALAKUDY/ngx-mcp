import type {BrowserContext} from 'playwright';
import {sampleUrl,type Sample} from '../src/samples.js';

export async function isolateSample(context:BrowserContext,sample:Sample){
  const origin=sampleUrl(sample);
  const writes:{method:string;path:string;body:unknown}[]=[];
  const blocked:string[]=[];
  const user={username:'Katherine',email:'katherine@example.test',token:'synthetic-test-token',bio:'',image:''};
  const courses:Record<string,unknown>[]=[];
  const state={failList:0,listReads:0,reads:[] as string[]};
  await context.route('**/*',async route=>{
    const request=route.request();const url=new URL(request.url());const path=url.pathname;
    const api=path.startsWith('/api/') || url.origin!==origin && /\/(users|user|articles|tags|profiles)(\/|$)/.test(path);
    if(api){
      const endpoint=path.replace(/^\/api/,'');
      const json=(body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':origin},body:JSON.stringify(body)});
      if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':origin,'access-control-allow-methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS','access-control-allow-headers':'content-type,authorization'}});
      if(sample.id==='realworld'&&request.method()==='POST'&&endpoint==='/users'){
        const body=request.postDataJSON();writes.push({method:'POST',path,body});return json({user:{...user,...body.user,token:'synthetic-test-token'}},201);
      }
      if(sample.id==='course-crud'&&request.method()==='POST'&&endpoint==='/courses'){
        const body=request.postDataJSON();writes.push({method:'POST',path,body});
        const course={...body,_id:String(courses.length+1),lessons:body.lessons.map((lesson:Record<string,unknown>,i:number)=>({...lesson,_id:i+1}))};courses.push(course);return json(course,201);
      }
      if(sample.id==='course-crud'&&/^\/courses\/[^/]+$/.test(endpoint)){
        const id=endpoint.split('/')[2];const index=courses.findIndex(c=>c._id===id);
        if(request.method()==='GET')return index<0?json({error:'Not found'},404):json(courses[index]);
        if(request.method()==='PUT'){const body=request.postDataJSON();writes.push({method:'PUT',path,body});courses[index]={...courses[index],...body};return json(courses[index]);}
        if(request.method()==='DELETE'){writes.push({method:'DELETE',path,body:null});courses.splice(index,1);return json({});}
      }
      if(sample.id==='forms-course'){
        if(request.method()==='POST'&&endpoint==='/thumbnail-upload'){writes.push({method:'POST',path,body:{multipart:(request.postData()??'').slice(0,600)}});return json({},200);}
        if(request.method()==='GET'&&/^\/courses\/\d+$/.test(endpoint))return json({id:Number(endpoint.split('/')[2]),description:'Fixture course',iconUrl:'',category:'BEGINNER',lessonsCount:12,seqNo:1,longDescription:'Fixture',courseListIcon:'',price:0,promo:false,url:'fixture'});
        if(request.method()==='GET'&&endpoint==='/lessons'){
          state.reads.push(url.search);const q=url.searchParams;const all=Array.from({length:12},(_,i)=>({id:i+1,seqNo:i+1,description:`Angular lesson ${i+1}`,duration:'1:00',courseId:1}));
          const filtered=all.filter(l=>l.description.toLowerCase().includes((q.get('filter')??'').toLowerCase()));if(q.get('sortOrder')==='desc')filtered.reverse();
          const size=Number(q.get('pageSize')||3),page=Number(q.get('pageNumber')||0);return json({payload:filtered.slice(page*size,(page+1)*size)});
        }
      }
      if(request.method()!=='GET')return json({errors:{body:['Mutation is outside this isolated scenario']}},403);
      if(endpoint==='/articles'||endpoint==='/articles/feed')return json({articles:[],articlesCount:0});
      if(endpoint==='/tags')return json({tags:[]});
      if(endpoint==='/user')return json({user});
      if(endpoint==='/course-categories')return json({categories:[{code:'BEGINNER',description:'Beginner'},{code:'ADVANCED',description:'Advanced'}]});
      if(sample.id==='course-crud'&&endpoint==='/courses'){state.listReads++;state.reads.push(url.search);if(state.failList>0){state.failList--;return json({error:'Fixture outage'},500);}}
      if(endpoint==='/courses')return json(sample.id==='course-crud'?(()=>{const size=Number(url.searchParams.get('pageSize')||courses.length||1),pg=Number(url.searchParams.get('page')||0);return {courses:courses.slice(pg*size,(pg+1)*size),totalElements:courses.length,totalPages:Math.max(1,Math.ceil(courses.length/size))};})():{payload:[]});
      if(endpoint==='/lessons')return json({payload:[]});
      return json({error:'Fixture endpoint not configured'},404);
    }
    if(url.origin===origin&&['GET','HEAD'].includes(request.method()))return route.continue();
    blocked.push(url.origin+path);return route.abort('blockedbyclient');
  });
  return {writes,blocked,courses,state};
}

export function redact(value:unknown):unknown{
  if(Array.isArray(value))return value.map(redact);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,value])=>[key,/password|token/i.test(key)?'[REDACTED]':redact(value)]));
  return value;
}

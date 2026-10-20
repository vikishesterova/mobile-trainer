import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFeedbackRelay} from './feedback-relay.mjs';
const origin='https://viktoriashesterova28-star.github.io';
const payload={rating:1,comment:'Проверка кириллицы',date:'2026-10-20T15:00:00.000Z'};
const request=(extra={},source=origin)=>new Request('https://relay.test/api/feedback',{
  method:'POST',headers:{origin:source,'Content-Type':'text/plain'},body:JSON.stringify({...payload,...extra})
});
const read=()=>new Request('https://relay.test/api/feedback',{headers:{origin}});
test('first submission uses one Google POST and waits for its acknowledgement',async()=>{
  let release,calls=[];
  const relay=createFeedbackRelay(async(_url,options)=>{
    calls.push(options.method);
    assert.deepEqual(JSON.parse(options.body),payload);
    return new Promise(resolve=>{release=()=>resolve(new Response('ok'));});
  });
  let finished=false;const result=relay(request({retry:false})).then(value=>{finished=true;return value;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,['POST']);assert.equal(finished,false);
  release();const response=await result;
  assert.equal(await response.text(),'ok');assert.equal(response.headers.get('Content-Type'),'text/plain; charset=utf-8');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
});
test('retry and legacy clients find an existing row without another POST',async()=>{
  for(const extra of [{retry:true},{}]){
    let calls=[];
    const relay=createFeedbackRelay(async(_url,options)=>{calls.push(options.method);return Response.json([payload]);});
    assert.equal(await(await relay(request(extra))).text(),'ok');assert.deepEqual(calls,['GET']);
  }
});
test('retry with no previous row uses lookup then one acknowledged POST',async()=>{
  let calls=[];
  const relay=createFeedbackRelay(async(_url,options)=>{
    calls.push(options.method);return options.method==='POST'?new Response('ok'):Response.json([]);
  });
  assert.equal(await(await relay(request({retry:true}))).text(),'ok');assert.deepEqual(calls,['GET','POST']);
});
test('concurrent copies share the pending operation',async()=>{
  let posts=0,release;
  const relay=createFeedbackRelay(async()=>{posts++;return new Promise(resolve=>{release=()=>resolve(new Response('ok'));});});
  const responses=[relay(request({retry:false})),relay(request({retry:false}))];
  await new Promise(resolve=>setImmediate(resolve));assert.equal(posts,1);release();
  assert.deepEqual(await Promise.all(responses.map(async r=>(await r).text())),['ok','ok']);
});
test('lost POST response is verified without automatically posting again',async()=>{
  let rows=[],calls=[];
  const relay=createFeedbackRelay(async(_url,options)=>{
    calls.push(options.method);
    if(options.method==='POST'){rows.push(JSON.parse(options.body));throw new TypeError('network');}
    return Response.json(rows);
  });
  assert.equal(await(await relay(request({retry:false}))).text(),'ok');assert.deepEqual(calls,['POST','GET']);
});
test('HTML and script errors are not treated as acknowledgements',async()=>{
  for(const body of ['<html>Sign in</html>','error: missing sheet']){
    let posts=0;
    const relay=createFeedbackRelay(async(_url,options)=>{
      if(options.method==='POST'){posts++;return new Response(body);}return Response.json([]);
    });
    const result=await relay(request({retry:false}));assert.equal(result.status,502);
    const error=await result.json();assert.equal(error.stage,'write');assert.ok(error.code.startsWith('GOOGLE_'));assert.equal(posts,1);
  }
});
test('safe reads retry a network failure; unrelated origins and invalid values never reach Google',async()=>{
  let calls=0;
  const relay=createFeedbackRelay(async()=>{if(++calls===1)throw new TypeError('network');return Response.json([]);});
  assert.deepEqual(await(await relay(read())).json(),[]);assert.equal(calls,2);
  assert.equal((await relay(request({rating:0}))).status,400);
  assert.equal((await relay(request({comment:'x'.repeat(4001)}))).status,400);
  assert.equal((await relay(request({},'https://unrelated.test'))).status,403);
  assert.equal(calls,2);
});
test('independent deadline finishes a fetch that ignores cancellation',async()=>{
  const relay=createFeedbackRelay(()=>new Promise(()=>{}),20);
  assert.equal((await relay(request({retry:false}))).status,504);
});

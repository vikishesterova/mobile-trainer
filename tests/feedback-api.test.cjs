const { test } = require('node:test');
const assert = require('node:assert/strict');
const createAPI = require('../js/feedback-api.js');
const payload = { date: '2026-10-29T12:55:52.155Z', rating: 3, comment: 'ппп' };
const response = (data, status = 200) => new Response(typeof data === 'string' ? data : JSON.stringify(data), {status});
test('normal submission only uses durable server acknowledgement', async () => {
  const calls=[];
  const api=createAPI(async (url,options)=>{calls.push({url,options}); return response('ok');});
  assert.deepEqual(await api.submit(payload),{confirmedBy:'server'});
  assert.equal(calls.length,1); assert.equal(calls[0].options.method,'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body),payload);
});
test('lost POST response is confirmed through the exact mirrored row, with no second write',async()=>{
  const calls=[]; let verifying=0;
  const api=createAPI(async(url,options)=>{calls.push(options.method);if(options.method==='POST')throw new TypeError('Failed to fetch');return response([payload]);});
  assert.deepEqual(await api.submit(payload,{onVerifying(){verifying++;}}),{confirmedBy:'google'});
  assert.deepEqual(calls,['POST','GET']);assert.equal(verifying,1);
});
test('matching comment or rating alone never counts as a confirmed submission',async()=>{
  for(const row of [{...payload,date:'2026-10-28T12:55:52.155Z'},{...payload,rating:5},{...payload,comment:'other'}]){
    const api=createAPI(async(url,options)=>{if(options.method==='POST')throw new TypeError('Failed to fetch');return response([row]);});
    await assert.rejects(api.submit(payload,{pollDelay:0}),/confirmation unavailable/);
  }
});
test('timeout includes a stalled response body even when fetch ignores abort',async()=>{
  const api=createAPI(async(url,options)=>options.method==='POST'?{ok:true,text:()=>new Promise(()=>{})}:response([payload]));
  assert.deepEqual(await api.submit(payload,{primaryTimeout:10}),{confirmedBy:'google'});
});
test('validation rejection is shown directly without looking up a stale row',async()=>{
  let requests=0;
  const api=createAPI(async()=>{requests++;return response({error:'Проверьте оценку'},400);});
  await assert.rejects(api.submit(payload),error=>error.status===400&&error.userMessage==='Проверьте оценку');
  assert.equal(requests,1);
});
test('dashboard remains available through Google when Sites cannot be reached; empty sheet rows are ignored',async()=>{
  let requests=0;
  const api=createAPI(async()=>{if(++requests===1)throw new TypeError('Failed to fetch');return response([{date:'',rating:0,comment:''},payload]);});
  assert.deepEqual(await api.read(),{rows:[payload],source:'google'});
});
test('neither unavailable service nor malformed data can show success',async()=>{
  for(const result of [()=>{throw new TypeError('network')},()=>response('<html>Error</html>'),()=>response({error:'no data'})]){
    const api=createAPI(async(url,options)=>{if(options.method==='POST')throw new TypeError('network');return result();});
    await assert.rejects(api.submit(payload,{pollDelay:0}));await assert.rejects(api.read());
  }
});

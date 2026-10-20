import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
const start=source.indexOf('  function sendSurveyToSheet(');
const end=source.indexOf('\n  // ============================================================================',start);
assert.ok(start>=0&&end>start);
function setup(fetchImpl){
  const requests=[],saved=[];
  const send=Function('SURVEY_ENDPOINT','saveSurveyDraft','surveyRequest','fetch',
    source.slice(start,end)+';return sendSurveyToSheet;')(
      'https://relay.test/api/feedback',
      survey=>saved.push(JSON.parse(JSON.stringify(survey))),
      operation=>operation({}),
      (url,options)=>{requests.push(JSON.parse(options.body));return fetchImpl?fetchImpl(url,options):Promise.resolve({ok:true,text:async()=>'ok'});}
    );
  return {send,requests,saved};
}
test('first delivery uses the fast path; retry keeps the same date and requests a duplicate check',async()=>{
  const {send,requests,saved}=setup();
  const survey={rating:2,comment:'Тест отзыва'};
  await send(survey);await send(survey);
  assert.equal(requests[0].retry,false);assert.equal(requests[1].retry,true);
  assert.equal(requests[0].date,requests[1].date);assert.equal(saved[0].delivery.attempted,true);
});
test('legacy drafts are treated as retries',async()=>{
  const {send,requests}=setup();
  const delivery={date:'2026-01-01T10:00:00.000Z',rating:1,comment:'Старый черновик'};
  await send({rating:1,comment:'Старый черновик',delivery});
  assert.equal(requests[0].retry,true);assert.equal(requests[0].date,delivery.date);
});
test('failed submission preserves the delivery identity for retry',async()=>{
  let fail=true;
  const {send,requests,saved}=setup(async()=>{if(fail)throw new TypeError('network');return {ok:true,text:async()=>'ok'};});
  const survey={rating:1,comment:'Старый черновик'};
  await assert.rejects(send(survey));fail=false;await send(survey);
  assert.equal(requests[0].retry,false);assert.equal(requests[1].retry,true);
  assert.equal(requests[0].date,requests[1].date);assert.equal(saved[0].comment,'Старый черновик');
});
test('editing a failed draft starts a new delivery identity',async()=>{
  const {send,requests}=setup();
  const survey={rating:2,comment:'Новый текст',delivery:{date:'2026-01-01T10:00:00.000Z',rating:1,comment:'Старый черновик'}};
  await send(survey);assert.equal(requests[0].retry,false);assert.notEqual(requests[0].date,'2026-01-01T10:00:00.000Z');
});

const GOOGLE_ENDPOINT = 'https://script.google.com/macros/s/AKfycby8k4_UduJDaFDiRZMVXlPdGBpeUPEgex8bbo2uqVyVLb-aV3LpsmOQLHJ68lIRT-er/exec';
const ALLOWED_ORIGINS = new Set(['https://viktoriashesterova28-star.github.io','https://mobile-trainer-feedback-relay.michellegreenrlg81.chatgpt.site']);

export function createFeedbackRelay(fetchGoogle = fetch, timeoutMs = 25000) {
  const pending = new Map();
  function headers(origin) {
    const h = new Headers({'Cache-Control':'no-store','Vary':'Origin','Content-Type':'application/json; charset=utf-8'});
    if (ALLOWED_ORIGINS.has(origin)) {
      h.set('Access-Control-Allow-Origin',origin);h.set('Access-Control-Allow-Methods','GET, POST, OPTIONS');
      h.set('Access-Control-Allow-Headers','Content-Type');h.set('Access-Control-Max-Age','86400');
    }
    return h;
  }
  function response(origin,value,status=200) {return new Response(JSON.stringify(value),{status,headers:headers(origin)});}
  function timed(operation,deadline) {
    return new Promise((resolve,reject)=>{
      const controller=new AbortController(),remaining=deadline-Date.now();let done=false;
      const timer=setTimeout(()=>{
        if(done)return;done=true;
        reject(Object.assign(new Error('upstream timeout'),{status:504}));controller.abort();
      },Math.max(1,remaining));
      Promise.resolve().then(()=>{
        if(remaining<=0)throw Object.assign(new Error('upstream timeout'),{status:504});
        return operation(controller.signal);
      }).then(value=>{if(done)return;done=true;clearTimeout(timer);resolve(value);},error=>{if(done)return;done=true;clearTimeout(timer);reject(error);});
    });
  }
  async function googleOnce(method,data,deadline) {
    return timed(async signal=>{
      const result=await fetchGoogle(GOOGLE_ENDPOINT+'?t='+Date.now(),{
        method,redirect:'follow',signal,headers:method==='POST'?{'Content-Type':'text/plain;charset=utf-8'}:{},
        ...(method==='POST'?{body:JSON.stringify(data)}:{})
      });
      if(!result.ok)throw Object.assign(new Error('upstream HTTP error'),{code:'GOOGLE_HTTP_'+result.status});
      const text=await result.text();
      if(method==='POST'){
        if(text.trim()!=='ok')throw Object.assign(new Error('upstream did not accept feedback'),{code:/^error:/i.test(text)?'GOOGLE_SCRIPT_ERROR':/^\s*</.test(text)?'GOOGLE_HTML':'GOOGLE_POST_RESPONSE'});
        return;
      }
      let rows;try{rows=JSON.parse(text);}catch{throw Object.assign(new Error('invalid upstream JSON'),{code:/^\s*</.test(text)?'GOOGLE_HTML':'GOOGLE_INVALID_JSON'});}
      if(!Array.isArray(rows))throw Object.assign(new Error('invalid upstream data'),{code:rows?.error?'GOOGLE_SCRIPT_ERROR':'GOOGLE_INVALID_ROWS'});
      return rows.filter(row=>row&&(row.date||row.rating||row.comment));
    },deadline);
  }
  async function google(method,data,deadline) {
    try{return await googleOnce(method,data,deadline);}catch(error){
      const retryable=!error.code||/^GOOGLE_HTTP_5\d\d$/.test(error.code);
      if(method!=='GET'||error.status===504||!retryable||Date.now()>=deadline)throw error;
      return googleOnce(method,data,deadline);
    }
  }
  function recorded(rows,payload) {
    return rows.some(row=>Date.parse(row.date)===Date.parse(payload.date)&&Number(row.rating)===payload.rating&&String(row.comment||'')===payload.comment);
  }
  async function body(request) {
    if(Number(request.headers.get('content-length'))>20000)throw Object.assign(new Error('large body'),{status:413});
    const reader=request.body?.getReader();if(!reader)throw Object.assign(new Error('missing body'),{status:400});
    const chunks=[];let length=0;
    while(true){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;
      if(length>20000){await reader.cancel();throw Object.assign(new Error('large body'),{status:413});}chunks.push(value);}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    let value;try{value=JSON.parse(new TextDecoder().decode(bytes));}catch{throw Object.assign(new Error('invalid JSON'),{status:400});}
    if(!value||!Number.isInteger(value.rating)||value.rating<1||value.rating>5||typeof value.comment!=='string'||value.comment.length>4000||typeof value.date!=='string'||!Number.isFinite(Date.parse(value.date)))throw Object.assign(new Error('invalid fields'),{status:400});
    return {
      payload:{rating:value.rating,comment:value.comment,date:new Date(value.date).toISOString()},
      // Старые клиенты не передают retry: для них сохраняется проверка прежней строки.
      retry:value.retry!==false
    };
  }
  return async function handle(request) {
    const origin=request.headers.get('origin')||'';
    if(origin&&!ALLOWED_ORIGINS.has(origin))return response(origin,{error:'Недопустимый источник запроса.'},403);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:headers(origin)});
    const started=Date.now(),deadline=started+timeoutMs;let stage=request.method==='GET'?'read':'validate';
    try{
      if(request.method==='GET')return response(origin,await google('GET',null,deadline));
      if(request.method!=='POST')return response(origin,{error:'Метод не поддерживается.'},405);
      if(!ALLOWED_ORIGINS.has(origin))return response(origin,{error:'Недопустимый источник запроса.'},403);
      const {payload,retry}=await body(request),key=JSON.stringify(payload);let task=pending.get(key);
      if(!task){
        task=(async()=>{
          if(retry){
            stage='lookup';if(recorded(await google('GET',null,deadline),payload))return;
          }
          stage='write';let writeError;
          try{
            await google('POST',payload,deadline);
            // doPost возвращает ok только после успешного appendRow.
            return;
          }catch(error){writeError=error;}
          // Потерянный ответ проверяем чтением; автоматически повторять POST нельзя.
          stage='verify';
          if(recorded(await google('GET',null,deadline),payload))return;
          stage='write';throw writeError;
        })();
        pending.set(key,task);task.finally(()=>pending.delete(key)).catch(()=>{});
      }
      await task;const h=headers(origin);h.set('Content-Type','text/plain; charset=utf-8');return new Response('ok',{status:200,headers:h});
    }catch(error){
      const status=error.status||502;
      const code=error.code||(status===504?'GOOGLE_TIMEOUT':status<500?'INVALID_REQUEST':'GOOGLE_NETWORK');
      if(status>=500)console.error('feedback_failure',JSON.stringify({stage,code,status,elapsedMs:Date.now()-started}));
      const message=status===400?'Проверьте оценку и комментарий.':status===413?'Комментарий слишком длинный.':'Не удалось подтвердить запись отзыва. Попробуйте еще раз.';
      return response(origin,{error:message,code,stage},status);
    }
  };
}
export const handleFeedback=createFeedbackRelay();

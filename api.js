(function(){
  'use strict';
  const DEFAULT_API_URL='https://script.google.com/macros/s/AKfycbw-TgIK0QH71_3QRjNvLj6MHZfuivmLOZ1a65NOHksI8LzO-QcRY4aY-90iektum3Mz8g/exec';
  const KEYS={api:'jood_api_url',legacySession:'jood_session_v2',reservation:'jood_reservations_v3'};
  const cache=new Map(), inflight=new Map();
  let capabilities={post:false,reservations:false,secureSession:false};
  function apiUrl(){return localStorage.getItem(KEYS.api)||DEFAULT_API_URL}
  function cacheKey(action,params){return action+':'+JSON.stringify(params||{},Object.keys(params||{}).sort())}
  function getCached(key,ttl){const x=cache.get(key);return x&&Date.now()-x.at<ttl?x.data:null}
  function putCache(key,data){cache.set(key,{data,at:Date.now()});return data}
  function clear(prefix){for(const k of cache.keys())if(!prefix||k.startsWith(prefix))cache.delete(k)}
  function jsonp(action,params={}){return new Promise((resolve,reject)=>{const cb='__jood_'+Date.now()+'_'+Math.floor(Math.random()*1e6);const script=document.createElement('script');const timer=setTimeout(()=>done(new Error('انتهت مهلة الاتصال بالخادم')),22000);function cleanup(){clearTimeout(timer);script.remove();try{delete window[cb]}catch(_){window[cb]=undefined}}function done(err,data){cleanup();err?reject(err):resolve(data)}window[cb]=data=>done(null,data);let url;try{url=new URL(apiUrl())}catch(_){done(new Error('رابط الخادم غير صحيح'));return}url.searchParams.set('action',action);url.searchParams.set('callback',cb);Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!==null)url.searchParams.set(k,String(v))});script.src=url.toString();script.onerror=()=>done(new Error('فشل الاتصال بالخادم'));document.body.appendChild(script)})}
  async function post(action,params={}){const body=new URLSearchParams({action,...Object.fromEntries(Object.entries(params).filter(([,v])=>v!==undefined&&v!==null).map(([k,v])=>[k,String(v)]))});const r=await fetch(apiUrl(),{method:'POST',body,redirect:'follow',credentials:'omit'});if(!r.ok)throw new Error('فشل الاتصال الآمن بالخادم');return r.json()}
  async function request(action,params={},opts={}){const ttl=opts.ttl||0,key=cacheKey(action,params);if(ttl){const hit=getCached(key,ttl);if(hit!==null)return hit}if(opts.dedupe!==false&&inflight.has(key))return inflight.get(key);const runner=(async()=>{let data;if(opts.preferPost&&capabilities.post){data=await post(action,params)}else if(opts.tryPost){try{data=await post(action,params);capabilities.post=true}catch(_){data=await jsonp(action,params)}}else data=await jsonp(action,params);if(ttl)putCache(key,data);return data})();inflight.set(key,runner);try{return await runner}finally{inflight.delete(key)}}
  async function login(user,pass){const res=await request('login',{user,pass},{tryPost:true,dedupe:false});const caps=res&&res.capabilities||res&&res.app&&res.app.capabilities||{};capabilities={post:!!(caps.post||res&&res.transport==='post'),reservations:!!caps.reservations,secureSession:!!(caps.secureSession||res&&res.token)};return res}
  function attachAuth(params={}){const s=Session.get();if(s&&s.token)return {...params,token:s.token};return params}
  function readData(res){return res&&Object.prototype.hasOwnProperty.call(res,'data')?res.data:res}
  const Api={
    DEFAULT_API_URL,KEYS,apiUrl,capabilities:()=>({...capabilities}),clear,
    setApiUrl(v){localStorage.setItem(KEYS.api,v);clear()},resetApiUrl(){localStorage.removeItem(KEYS.api);clear()},
    login,
    summary:()=>request('summary',attachAuth(),{ttl:20000}),
    dashboard:(ready=false)=>request('getDashboardClients',attachAuth({ready:ready?'true':'false'}),{ttl:12000}),
    clientModels:(client,ready=false)=>request('getClientModels',attachAuth({client,ready:ready?'true':'false'}),{ttl:18000}),
    models:()=>request('getModelsByPrefix',attachAuth(),{ttl:30000}),
    search:q=>request('searchClients',attachAuth({q}),{ttl:12000}),
    async deliver(client,items){const res=await request('deliver',attachAuth({client,items:encodeItems(items)}),{preferPost:capabilities.post,dedupe:false});clear();return res},
    async reserve(client,invoice,items){if(!capabilities.reservations)return {ok:false,unsupported:true};const res=await request('reserveStock',attachAuth({client,invoice:invoice||'',items:encodeItems(items)}),{preferPost:capabilities.post,dedupe:false});clear();return res},
    async releaseReservation(client,invoice,model){if(!capabilities.reservations)return {ok:false,unsupported:true};const res=await request('releaseReservation',attachAuth({client,invoice:invoice||'',model}),{preferPost:capabilities.post,dedupe:false});clear();return res},
    readData
  };
  function encodeItems(items){const json=JSON.stringify(items||[]);return btoa(unescape(encodeURIComponent(json))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'')}
  const Session={
    get(){try{return JSON.parse(sessionStorage.getItem('jood_session_v3')||'null')}catch(_){return null}},
    set(value){sessionStorage.setItem('jood_session_v3',JSON.stringify(value||{}));localStorage.removeItem(KEYS.legacySession)},
    clear(){sessionStorage.removeItem('jood_session_v3');localStorage.removeItem(KEYS.legacySession)},
    migrate(){try{const old=JSON.parse(localStorage.getItem(KEYS.legacySession)||'null');if(old&&!this.get()){this.set(old);return old}}catch(_){}return this.get()}
  };
  window.Api=Api;window.Session=Session;
})();

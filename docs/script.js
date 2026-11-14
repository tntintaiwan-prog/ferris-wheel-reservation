import {API_BASE} from './config.js';
const $=id=>document.getElementById(id);
const base=API_BASE.replace(/\/$/,'');
const status={pending:'等待執行',completed:'已完成',cancelled:'已取消'};
const today=ms=>new Date(ms+28800000).toISOString().slice(0,10);
let selected='', busy=false, loadVersion=0;
async function api(path,options={}){
  if(!base)throw Error('尚未設定線上服務。請依部署說明設定 Worker 網址。');
  const r=await fetch(base+path,{...options,signal:AbortSignal.timeout(35000),cache:'no-store'});
  const data=await r.json();if(!r.ok)throw Error(data.error||'操作未成功。');return data;
}
function keyFor(date,time){
  const k='ferris-request:'+date+':'+time;
  let key=localStorage.getItem(k);
  if(!key){key=Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');localStorage.setItem(k,key);}
  return [k,key];
}
function description(r){return r.date+' '+r.time+'（臺灣時間）｜'+status[r.status];}
async function load(){
  const token=++loadVersion, date=$('day').value;selected='';$('submit').disabled=true;$('slots').textContent='載入時段…';
  try{
    const data=await api('/api/slots?date='+encodeURIComponent(date));
    if(token!==loadVersion)return;
    $('slots').replaceChildren();
    for(const s of data.slots){
      const b=document.createElement('button'), state=document.createElement('small');
      b.type='button';b.textContent=s.time+'～'+String(Number(s.time.slice(0,2))+1).padStart(2,'0')+':00';
      let retry=false;try{retry=!!localStorage.getItem('ferris-request:'+date+':'+s.time);}catch{}
      state.textContent=retry?'確認上次送出':s.available?'可預約':'不可預約';b.append(state);b.disabled=!s.available&&!retry;
      b.setAttribute('aria-pressed','false');b.onclick=()=>{
        if(busy)return;selected=s.time;
        for(const x of $('slots').children)x.setAttribute('aria-pressed',String(x===b));$('submit').disabled=false;
      };$('slots').append(b);
    }
  }catch(e){if(token===loadVersion)$('slots').textContent=e.message;}
}
$('day').min=today(Date.now());$('day').max=today(Date.now()+90*86400000);$('day').value=$('day').min;
$('day').onchange=()=>{$('notice').textContent='';load();};
if(base){$('admin').href=base+'/admin/';$('admin').hidden=false;}
$('book').onsubmit=async e=>{
  e.preventDefault();if(busy||!selected)return;
  busy=true;$('submit').disabled=true;$('day').disabled=true;$('notice').textContent='正在送出預約…';
  const date=$('day').value,time=selected;
  try{
    const [k,requestKey]=keyFor(date,time);
    const r=await api('/api/reservations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date,time,requestKey})});
    try{localStorage.removeItem(k);}catch{}
    $('receiptId').value=r.id;$('id').value=r.id;$('receipt').hidden=false;
    $('notice').textContent='已確認儲存：'+description(r);await load();
  }catch(e){
    $('notice').textContent=e.message+' 若連線中斷，請先用同一時段重試。';
  }finally{busy=false;$('day').disabled=false;$('submit').disabled=!selected;}
};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('receiptId').value);$('notice').textContent='已複製預約編號。';}catch{$('receiptId').select();$('notice').textContent='請長按或選取編號後複製。';}};
$('query').onsubmit=async e=>{
  e.preventDefault();const id=$('id').value.trim(), button=e.submitter;
  if(!/^R-[0-9a-f]{32}$/.test(id)){$('result').textContent='請輸入完整預約編號。';return;}
  if(button)button.disabled=true;$('result').textContent='查詢中…';
  try{$('result').textContent=description(await api('/api/reservations/'+encodeURIComponent(id)));}catch(e){$('result').textContent=e.message;}finally{if(button)button.disabled=false;}
};
load();

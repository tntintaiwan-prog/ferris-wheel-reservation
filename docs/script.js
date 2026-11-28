import {API_BASE} from './config.js';
const $=id=>document.getElementById(id);
const base=API_BASE.replace(/\/$/,'');
const status={pending:'等待執行',checked_in:'已報到',running:'流程執行中',completed:'已完成',cancelled:'已取消'};
const today=ms=>new Date(ms+28800000).toISOString().slice(0,10);
let plaque=null, selected='', busy=false, loadVersion=0;
async function api(path,options={}){
  if(!base)throw Error('尚未設定線上服務。請依部署說明設定 Worker 網址。');
  const r=await fetch(base+path,{...options,signal:AbortSignal.timeout(35000),cache:'no-store'});
  const data=await r.json();if(!r.ok)throw Error(data.error||'操作未成功。');return data;
}
function keyFor(date,time,code){
  const k='ferris-request:'+date+':'+time+':'+code;
  let key=localStorage.getItem(k);
  if(!/^[0-9a-f]{32}$/.test(key||'')){key=Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');localStorage.setItem(k,key);}
  return [k,key];
}
function description(r){return r.date+' '+r.time+'（臺灣時間）｜'+status[r.status]+(r.plaque?'｜牌位 '+r.plaque.code+' '+r.plaque.name:'｜未指定牌位');}
async function load(){
  const token=++loadVersion, date=$('day').value;selected='';$('submit').disabled=true;$('slots').textContent='載入時段…';
  try{
    const data=await api('/api/slots?date='+encodeURIComponent(date));
    if(token!==loadVersion)return;
    $('slots').replaceChildren();
    for(const s of data.slots){
      const b=document.createElement('button'), state=document.createElement('small');
      b.type='button';b.textContent=s.time+'～'+String(Number(s.time.slice(0,2))+1).padStart(2,'0')+':00';
      let retry=false;try{retry=!!localStorage.getItem('ferris-request:'+date+':'+s.time+':'+plaque?.code);}catch{}
      state.textContent=retry?'確認上次送出':s.available?'可預約':'不可預約';b.append(state);b.disabled=!s.available&&!retry;
      b.setAttribute('aria-pressed','false');b.onclick=()=>{
        if(busy||!plaque)return;selected=s.time;
        for(const x of $('slots').children)x.setAttribute('aria-pressed',String(x===b));$('submit').disabled=false;
      };$('slots').append(b);
    }
  }catch(e){if(token===loadVersion)$('slots').textContent=e.message;}
}
$('day').min=today(Date.now());$('day').max=today(Date.now()+90*86400000);$('day').value=$('day').min;
$('day').onchange=()=>{$('notice').textContent='';load();};
if(base){$('admin').href=base+'/admin/';$('admin').hidden=false;}
$('book').onsubmit=async e=>{
  e.preventDefault();if(busy||!selected||!plaque)return;
  busy=true;$('submit').disabled=true;$('day').disabled=true;$('notice').textContent='正在送出預約…';
  const date=$('day').value,time=selected,plaqueCode=plaque.code;
  try{
    const [k,requestKey]=keyFor(date,time,plaqueCode);
    const r=await api('/api/reservations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date,time,requestKey,plaqueCode})});
    try{localStorage.removeItem(k);}catch{}
    $('receiptId').value=r.id;$('id').value=r.id;$('receipt').hidden=false;$('onsiteId').value=r.id;$('onsiteCode').value=r.plaque.code;
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
  $('queryToOnsite').hidden=true;
  try{const r=await api('/api/reservations/'+encodeURIComponent(id));$('result').textContent=description(r);
    if(r.plaque&&$('id').value.trim()===id){$('onsiteCode').value=r.plaque.code;$('onsiteId').value=r.id;$('queryToOnsite').hidden=false;}
  }catch(e){$('result').textContent=e.message;}finally{if(button)button.disabled=false;}
};
load();
function showPage(){
  const onsite=location.hash==='#onsite';
  const bluetooth=location.hash==='#bluetooth';
  $('onsite').hidden=!onsite;$('bluetooth').hidden=!bluetooth;$('booking').hidden=onsite||bluetooth;
}
window.addEventListener('hashchange',showPage);showPage();
let onsiteBusy=false, onsiteData=null, moveAbort=null, timerOffset=0;
const validReservation=id=>/^R-[0-9a-f]{32}$/.test(id);
function onsiteRequest(code,action,id,job){
  if(action==='lookup')return api('/api/onsite?'+new URLSearchParams({code,...(validReservation(id)?{id}:{})}));
  return api('/api/onsite',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,action,id,job})});
}
function clearOnsite(){onsiteData=null;$('onsiteControls').hidden=true;$('onsiteActions').replaceChildren();$('ritualClock').hidden=true;}
function updateClock(){
  const r=onsiteData?.reservation;
  if(!r?.startedAt||r.status!=='running'){$('ritualClock').hidden=true;return;}
  const seconds=Math.max(0,Math.ceil((Date.parse(r.endsAt)-(Date.now()+timerOffset))/1000));
  $('ritualClock').hidden=false;$('countdown').textContent=[Math.floor(seconds/3600),Math.floor(seconds%3600/60),seconds%60].map(n=>String(n).padStart(2,'0')).join(':');
  $('timeReminder').textContent=seconds?'祭拜進行中。':'祭拜時間已到。';
}
setInterval(updateClock,1000);
async function lookupOnsite(code){
  clearOnsite();$('onsiteResult').textContent='查詢中…';
  try{
    const data=await onsiteRequest(code,'lookup',$('onsiteId').value.trim());
    if($('onsiteCode').value.trim()!==code)return;
    onsiteData=data;if(data.serverNow)timerOffset=Date.parse(data.serverNow)-Date.now();
    const seconds=data.waitSeconds,minutes=Math.ceil(seconds/60);
    $('onsiteResult').textContent=description(data.reservation)+(minutes?'｜尚未到時，約需等待 '+Math.floor(minutes/60)+' 小時 '+minutes%60+' 分鐘':'');
    if(data.deviceOccupied)$('onsiteResult').textContent+='｜設備正在其他祭拜流程中，請稍候重新查詢。';
    renderOnsite();
  }catch(e){if($('onsiteCode').value.trim()===code)$('onsiteResult').textContent=e.message;}
}
function renderOnsite(){
  $('onsiteActions').replaceChildren();if(!onsiteData)return;
  const {reservation:r,allowed}=onsiteData;
  const choices=[['check','報到'],['start','移動到預約牌位'],['take','已取出，開始祭拜'],['end','已放回，結束祭拜'],['cancel','取消預約']];
  if(r.status==='running'&&r.motion?.status==='requested')choices.unshift(['resume','繼續／確認本次定位'],['abort','取消本次移動']);
  for(const [action,label] of choices){
    if(action!=='resume'&&!allowed[action])continue;
    const b=document.createElement('button');b.type='button';b.textContent=label;b.disabled=onsiteBusy;
    b.onclick=()=>performOnsite(action);$('onsiteActions').append(b);
  }
  $('onsiteControls').hidden=false;updateClock();
}
async function performOnsite(action){
  if(onsiteBusy||!onsiteData)return;
  const code=$('onsiteCode').value.trim(),id=$('onsiteId').value.trim();
  if(!validReservation(id)){$('onsiteFeedback').textContent='請輸入預約成功時取得的完整 R-… 編號。';$('onsiteId').focus();return;}
  if(['start','resume'].includes(action)&&!publicMotor.ready){$('onsiteFeedback').textContent=publicMotor.connected?'設備尚未校正原點，請管理員處理。':'請先連接 ESP32，再回到現場操作。';return;}
  if(action==='cancel'&&!confirm('確定取消這筆預約？'))return;
  if(action==='take'&&!confirm('請確認已取出牌位，現在開始一小時計時？'))return;
  if(action==='end'&&!confirm('請確認牌位已放回，再結束本次祭拜。'))return;
  onsiteBusy=true;renderOnsite();$('onsiteCode').disabled=true;$('onsiteId').disabled=true;$('onsiteFeedback').textContent='處理中…';
  try{
    if(action==='start'||action==='resume'){
      moveAbort=new AbortController();const signal=moveAbort.signal;$('stopMovement').hidden=false;
      const begun=await onsiteRequest(code,'start',id);
      const r=begun.reservation;
      $('onsiteFeedback').textContent='正在移動到第 '+r.position+' 格，請保持此頁開啟；必要時按緊急停止。';
      try{
        if(signal.aborted)throw Error('操作已中斷，未啟動馬達。');
        await publicMotor.runTo(r.position,r.motion.job,{signal});
      }
      catch(e){
        await onsiteRequest(code,'abort',id,r.motion.job).catch(()=>{});
        throw e;
      }finally{moveAbort=null;$('stopMovement').hidden=true;}
      await onsiteRequest(code,'arrived',id,r.motion.job);
      $('onsiteFeedback').textContent='移動指令已完成。';
    }else{
      if(action==='abort')await publicMotor.stop().catch(()=>{});
      const result=await onsiteRequest(code,action,id,action==='abort'?onsiteData.reservation.motion?.job:undefined);
      if(result.serverNow)timerOffset=Date.parse(result.serverNow)-Date.now();
      $('onsiteFeedback').textContent={check:'報到成功。',take:'祭拜已開始。',end:'祭拜已結束。',cancel:'已取消預約。',abort:'本次移動已取消，請管理員確認原點後再試。'}[action];
      if(['cancel','end'].includes(action)){onsiteData={reservation:result.reservation,allowed:{}};renderOnsite();$('onsiteResult').textContent=description(result.reservation);return;}
    }
    await lookupOnsite(code);
  }catch(e){$('onsiteFeedback').textContent=e.message+' 若網路中斷，請保留同一預約編號重新查詢，勿重複建立預約。';}
  finally{moveAbort=null;$('stopMovement').hidden=true;onsiteBusy=false;$('onsiteCode').disabled=false;$('onsiteId').disabled=false;renderOnsite();}
}
$('stopMovement').onclick=()=>{moveAbort?.abort();};
function interruptMovement(){if(moveAbort)moveAbort.abort();}
addEventListener('pagehide',interruptMovement);addEventListener('blur',interruptMovement);
document.addEventListener('visibilitychange',()=>{if(document.hidden)interruptMovement();});
$('onsiteCode').oninput=()=>{clearOnsite();$('onsiteResult').textContent='';$('onsiteFeedback').textContent='';};
$('onsiteId').oninput=()=>{clearOnsite();$('onsiteResult').textContent='輸入完成後請重新查詢。';};
$('onsiteForm').onsubmit=async e=>{
  e.preventDefault();if(onsiteBusy)return;
  const id=$('onsiteId').value.trim();if(id&&!validReservation(id)){$('onsiteFeedback').textContent='預約編號格式錯誤，請貼上完整 R-… 編號。';return;}
  onsiteBusy=true;try{await lookupOnsite($('onsiteCode').value.trim());}finally{onsiteBusy=false;renderOnsite();}
};

$('plaque').oninput=()=>{plaque=null;selected='';$('submit').disabled=true;$('plaqueResult').textContent='';};
$('confirmPlaque').onclick=async()=>{
  const code=$('plaque').value.trim();if(!code||busy)return;
  $('plaqueResult').textContent='確認中…';
  try{const p=await api('/api/plaque?code='+encodeURIComponent(code));if($('plaque').value.trim()!==code)return;plaque=p;$('plaqueResult').textContent='祭拜對象：'+p.code+(p.name?'｜'+p.name:'');await load();}
  catch(e){plaque=null;$('submit').disabled=true;$('plaqueResult').textContent=e.message;}
};

let publicConnecting=false;
function bleStatus(message){$('publicBleStatus').textContent=message;}
const publicMotor=new FerrisMotor(state=>{
  if(!state)bleStatus('藍牙已中斷；定位中斷時需管理員重新校正原點。');
  else if(['I','U','E'].includes(state.phase))bleStatus('已連接，但尚未校正原點，請管理員先完成校正。');
  else if(state.phase==='M')bleStatus('正在定位到第 '+state.slot+' 格，請保持此頁開啟。');
  else if(['R','D'].includes(state.phase))bleStatus('已連接且原點有效，可返回現場操作。');
  $('publicBleDisconnect').disabled=!publicMotor.connected;
  $('publicBleConnect').disabled=publicConnecting||publicMotor.connected;
});
$('publicBleConnect').onclick=async()=>{
  if(publicConnecting||publicMotor.connected)return;
  publicConnecting=true;$('publicBleConnect').disabled=true;bleStatus('正在選擇 ESP32…');
  try{await publicMotor.connect();}
  catch(e){bleStatus(e.name==='NotFoundError'?'未選取裝置。':e.message);}
  finally{publicConnecting=false;$('publicBleConnect').disabled=publicMotor.connected;$('publicBleDisconnect').disabled=!publicMotor.connected;}
};
$('publicBleDisconnect').onclick=()=>{interruptMovement();publicMotor.disconnect();};
addEventListener('pagehide',()=>publicMotor.disconnect());

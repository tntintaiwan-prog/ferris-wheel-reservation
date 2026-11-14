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
let scanGeneration=0;
function showPage(){
  const onsite=location.hash==='#onsite';
  const bluetooth=location.hash==='#bluetooth';
  $('onsite').hidden=!onsite;$('bluetooth').hidden=!bluetooth;$('booking').hidden=onsite||bluetooth;
  if(!bluetooth)stopCamera();
}
window.addEventListener('hashchange',showPage);showPage();
let onsiteBusy=false;
const onsiteRequest=(code,action,id)=>api('/api/onsite',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,action,id})});
function clearOnsite(){$('onsiteControls').hidden=true;$('onsiteActions').replaceChildren();}
async function lookupOnsite(code){
  clearOnsite();$('onsiteResult').textContent='查詢中…';
  try{
    const data=await onsiteRequest(code,'lookup');
    if($('onsiteCode').value.trim()!==code)return;
    const minutes=Math.ceil(data.waitSeconds/60);
    $('onsiteResult').textContent=description(data.reservation)+(minutes?'｜尚未到時，約需等待 '+(minutes>=60?Math.floor(minutes/60)+' 小時 ':'')+minutes%60+' 分鐘':'');
    for(const [action,label] of [['check','報到'],['cancel','取消預約'],['start','移動（流程測試）'],['end','結束']]){
      if(!data.allowed[action])continue;
      const b=document.createElement('button');b.type='button';b.textContent=label;$('onsiteActions').append(b);
      b.onclick=async()=>{
        if(onsiteBusy)return;
        if(action==='start'&&!publicDevice?.gatt?.connected){
          $('onsiteFeedback').textContent='請先連接 ESP32 藍牙，再回來操作。';return;
        }
        const id=$('onsiteId').value.trim();
        if(!/^R-[0-9a-f]{32}$/.test(id)){$('onsiteFeedback').textContent='請輸入完整預約編號。';return;}
        if(action==='cancel'&&!confirm('確定取消這筆預約？'))return;
        onsiteBusy=true;$('onsiteFeedback').textContent='處理中…';
        try{await onsiteRequest(code,action,id);$('onsiteFeedback').textContent=label+'成功。';await lookupOnsite(code);await load();}
        catch(e){$('onsiteFeedback').textContent=e.message;}finally{onsiteBusy=false;}
      };
    }
    $('onsiteControls').hidden=!$('onsiteActions').children.length;
  }catch(e){if($('onsiteCode').value.trim()===code)$('onsiteResult').textContent=e.message;}
}
$('onsiteCode').oninput=()=>{clearOnsite();$('onsiteResult').textContent='';$('onsiteFeedback').textContent='';};
$('onsiteForm').onsubmit=async e=>{
  e.preventDefault();if(onsiteBusy)return;onsiteBusy=true;$('onsiteFeedback').textContent='';
  try{await lookupOnsite($('onsiteCode').value.trim());}finally{onsiteBusy=false;}
};

$('plaque').oninput=()=>{plaque=null;selected='';$('submit').disabled=true;$('plaqueResult').textContent='';};
$('confirmPlaque').onclick=async()=>{
  const code=$('plaque').value.trim();if(!code||busy)return;
  $('plaqueResult').textContent='確認中…';
  try{const p=await api('/api/plaque?code='+encodeURIComponent(code));if($('plaque').value.trim()!==code)return;plaque=p;$('plaqueResult').textContent='祭拜對象：'+p.code+(p.name?'｜'+p.name:'');await load();}
  catch(e){plaque=null;$('submit').disabled=true;$('plaqueResult').textContent=e.message;}
};

let publicDevice, publicConnecting=false;
$('publicBleConnect').onclick=async()=>{
  if(publicConnecting||publicDevice?.gatt?.connected)return;
  if(!navigator.bluetooth){bleStatus('此瀏覽器無法使用網頁藍牙，請改用支援的 Chrome 並開啟藍牙。');return;}
  const service='640ac120-467c-459d-8899-913ea30645b1';
  publicConnecting=true;$('publicBleConnect').disabled=true;bleStatus('正在選擇裝置…');
  try{
    const device=await navigator.bluetooth.requestDevice({filters:[{services:[service]}]});
    publicDevice=device;
    device.addEventListener('gattserverdisconnected',()=>{
      if(publicDevice!==device)return;
      $('publicBleDisconnect').disabled=true;$('publicBleConnect').disabled=false;bleStatus('連線已中斷。');
    });
    const gatt=await device.gatt.connect();
    await gatt.getPrimaryService(service);
    if(!gatt.connected)throw Error('Disconnected');
    $('publicBleDisconnect').disabled=false;bleStatus('已連接 ESP32。可返回現場操作。');
  }catch(e){
    publicDevice?.gatt?.disconnect();bleStatus(e.name==='NotFoundError'?'未選取裝置。':'連線失敗，請確認 ESP32 韌體與藍牙狀態。');
  }finally{publicConnecting=false;$('publicBleConnect').disabled=!!publicDevice?.gatt?.connected;}
};
$('publicBleDisconnect').onclick=()=>publicDevice?.gatt?.disconnect();
addEventListener('pagehide',()=>publicDevice?.gatt?.disconnect());
function stopCamera(){
  ++scanGeneration;
  const video=$('qrVideo');
  video.srcObject?.getTracks().forEach(track=>track.stop());
  video.srcObject=null;video.hidden=true;
  $('stopScan').hidden=true;$('scanQr').disabled=false;
}
$('stopScan').onclick=()=>{stopCamera();$('scanStatus').textContent='相機已關閉。';};
addEventListener('pagehide',stopCamera);
$('scanQr').onclick=async()=>{
  if(!navigator.mediaDevices?.getUserMedia||!globalThis.BarcodeDetector){
    $('scanStatus').textContent='此瀏覽器不支援網頁掃碼。請直接按「連接 ESP32」。';return;
  }
  const run=++scanGeneration, status=$('scanStatus'), video=$('qrVideo');
  $('scanQr').disabled=true;$('stopScan').hidden=false;status.textContent='等待相機權限…';
  try{
    if(!(await BarcodeDetector.getSupportedFormats()).includes('qr_code'))throw Error();
    if(run!==scanGeneration)return;
    const detector=new BarcodeDetector({formats:['qr_code']});
    const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});
    if(run!==scanGeneration){stream.getTracks().forEach(t=>t.stop());return;}
    video.srcObject=stream;video.hidden=false;await video.play();
    const expected='https://tntintaiwan-prog.github.io/ferris-wheel-reservation/#bluetooth';
    status.textContent='請將現場設備 QR Code 對準鏡頭。';
    async function frame(){
      if(run!==scanGeneration)return;
      try{
        const results=await detector.detect(video);
        if(run!==scanGeneration)return;
        if(results.some(x=>x.rawValue===expected)){
          stopCamera();status.textContent='已辨識現場設備標籤。請按「連接 ESP32」並確認裝置。';
          $('publicBleConnect').focus();return;
        }
        if(results.length)status.textContent='這不是本系統的設備 QR Code。';
        setTimeout(frame,200);
      }catch{if(run===scanGeneration){stopCamera();status.textContent='掃描中斷，仍可直接連接 ESP32。';}}
    }
    frame();
  }catch{if(run===scanGeneration){stopCamera();status.textContent='無法開啟相機或辨識 QR Code，請直接連接 ESP32。';}}
};

'use strict';
// Shared protocol 3 client. Keep docs/motor.js and worker/admin/motor.js identical.
(() => {
 const SERVICE='640ac120-467c-459d-8899-913ea30645b1';
 const TX='640ac121-467c-459d-8899-913ea30645b1', RX='640ac122-467c-459d-8899-913ea30645b1';
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 class FerrisMotor {
  constructor(onState=()=>{}){this.onState=onState;this.queue=Promise.resolve();this.state=null;this.busy=false;this.perSlot=0;}
  get connected(){return !!this.device?.gatt?.connected&&!!this.tx;}
  get ready(){return this.connected&&['R','D'].includes(this.state?.phase);}
  accept(raw){
   const fields=raw.split(',');if(fields[0]!=='3'||!['I','U','R','J','M','D','E'].includes(fields[1]))throw Error('請先上傳新版牌位定位韌體（第 3 版）。');
   const [version,phase,slot,data]=fields;this.state={phase,slot:Number(slot),job:['M','D','E'].includes(phase)?data:null};
   if(['I','U','R','J'].includes(phase))this.perSlot=Number(data);
   this.onState(this.state);return this.state;
  }
  async connect(){
   if(!navigator.bluetooth)throw Error('iPhone 請用 Bluefy；Android 請用支援網頁藍牙的 Chrome。');
   this.device=await navigator.bluetooth.requestDevice({filters:[{services:[SERVICE]}]});
   this.device.addEventListener('gattserverdisconnected',()=>{this.tx=null;this.state=null;this.onState(null);});
   try{
    const gatt=await this.device.gatt.connect(),svc=await gatt.getPrimaryService(SERVICE);
    this.tx=await svc.getCharacteristic(TX);this.rx=await svc.getCharacteristic(RX);
    await this.read();this.rx.addEventListener('characteristicvaluechanged',e=>{try{this.accept(new TextDecoder().decode(e.target.value));}catch{this.disconnect();}});
    // Completion packets carry a job, not calibration. Read the independent setting.
    try{
      const config=await svc.getCharacteristic('640ac123-467c-459d-8899-913ea30645b1');
      const pulses=Number(new TextDecoder().decode(await config.readValue()));
      if(Number.isInteger(pulses)&&pulses>=1&&pulses<=50000)this.perSlot=pulses;
    }catch{/* Early v3 firmware can still operate with the conservative timeout. */}
    await this.rx.startNotifications();return this.state;
   }catch(e){this.disconnect();throw e;}
  }
  enqueue(fn){
   const task=this.queue.then(async()=>{
    if(!this.connected)throw Error('ESP32 已斷線，請重新連接。');
    let timer;
    try{return await Promise.race([fn(),new Promise((_,reject)=>{timer=setTimeout(()=>{this.disconnect();reject(Error('藍牙回應逾時，已中斷連線。'));},3000);})]);}
    finally{clearTimeout(timer);}
   });this.queue=task.catch(()=>{});return task;
  }
  write(text){return this.enqueue(()=>this.tx.writeValueWithResponse(new TextEncoder().encode(text)));}
  read(){return this.enqueue(async()=>this.accept(new TextDecoder().decode(await this.rx.readValue())));}
  disconnect(){this.device?.gatt?.disconnect();this.tx=null;this.state=null;}
  stop(){return this.write('S');}
  async configure(pulses){
   if(!Number.isInteger(pulses)||pulses<1||pulses>50000)throw Error('每格脈波請輸入 1～50000 的整數。');
   if(this.busy||['J','M'].includes(this.state?.phase))throw Error('請先停止馬達。');
   await this.write('C'+pulses);
   for(let i=0;i<20;i++){await sleep(50);await this.read();if(this.state.phase==='U'&&this.perSlot===pulses)return;}
   throw Error('ESP32 未確認儲存，請重新讀取設定。');
  }
  async home(){
   if(this.busy||['J','M'].includes(this.state?.phase))throw Error('請先停止馬達。');
   if(!this.perSlot)throw Error('請先設定每格脈波。');
   await this.write('O');for(let i=0;i<20;i++){await sleep(50);await this.read();if(this.state.phase==='R'&&this.state.slot===1)return;}
   throw Error('原點尚未確認，請重試。');
  }
  async runTo(slot,job,{signal}={}){
   if(this.busy)throw Error('已有移動執行中。');
   if(!this.ready)throw Error('設備尚未校正原點，請管理員先完成校正。');
   if(!Number.isInteger(slot)||slot<1||slot>8||!/^[0-9a-f]{8}$/.test(job)||job==='00000000')throw Error('定位指令格式錯誤。');
   if(signal?.aborted)throw Error('已取消移動。');
   this.busy=true;const cancel=()=>{this.stop().catch(()=>this.disconnect());};signal?.addEventListener('abort',cancel,{once:true});
   try{
    await this.write('G'+slot+job);const began=Date.now(),limit=this.perSlot?Math.min(1800000,Math.max(20000,this.perSlot*32+10000)):1800000;
    for(;;){
     if(signal?.aborted)throw Error('定位已中斷，請重新校正原點。');
     const state=await this.read();
     if(state.phase==='D'&&state.job===job&&state.slot===slot)return state;
     if(['I','U','E'].includes(state.phase))throw Error('設備尚未校正或定位中斷，請管理員重新校正。');
     if(Date.now()-began>limit)throw Error('定位逾時，已要求停止。');
     if(Date.now()-began>3000&&!(state.phase==='M'&&state.job===job))throw Error('設備未接受本次定位指令。');
     await sleep(100);if(signal?.aborted)throw Error('定位已中斷。');await this.write('H');
    }
   }catch(e){await this.stop().catch(()=>this.disconnect());throw e;}
   finally{this.busy=false;signal?.removeEventListener('abort',cancel);}
  }
 }
 globalThis.FerrisMotor=FerrisMotor;
})();

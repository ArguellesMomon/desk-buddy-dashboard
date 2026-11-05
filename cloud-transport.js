'use strict';
class BuddyRelayTransport {
  constructor({mqtt,notify=()=>{},now=()=>Date.now(),ready=()=>{},onConnection=()=>{},timers=globalThis}){
    Object.assign(this,{mqtt,notify,now,ready,onConnection,timers});
    this.pending=new Map();this.syncIds=new Set();this.generation=0;this.client=null;this.state=null;this.received=0;this.attempts=0;this.everReady=false;this.status={code:'idle',message:'Not connected'};
  }
  static config(host,device,username,password){
    host=String(host||'').trim().toLowerCase();device=String(device||'').trim();username=String(username||'').trim();
    if(!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.emqxsl\.com$/.test(host)||host.includes('..')||host.length>150)throw Error('Check the broker address in connection details.');
    if(!/^[a-z0-9][a-z0-9-]{0,31}$/.test(device))throw Error('Buddy ID needs 1–32 lowercase letters, numbers or hyphens.');
    if(!username||!password||username.length>128||password.length>256||/[^\x20-\x7e]/.test(username+password))throw Error('Enter your Buddy username and password.');
    return{host,device,username,password};
  }
  static refusal(error){
    const code=Number(error?.code??error?.returnCode??error?.reasonCode);
    if([4,134].includes(code))return{code:'auth_error',message:'Incorrect username or password.'};
    if([5,135].includes(code))return{code:'auth_error',message:'Login rejected. Check your username and password.'};
    if([1,2,132,133].includes(code))return{code:'broker_error',message:'The message service rejected this connection.'};
    return null;
  }
  id(){return Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');}
  setStatus(code,message){this.status={code,message};this.notify(message,this.status);this.onConnection(this.status);}
  clearTimer(name){if(this[name]!=null)this.timers.clearTimeout(this[name]);this[name]=null;}
  rejectPending(message){for(const entry of this.pending.values()){this.timers.clearTimeout(entry.timer);entry.reject(Error(message));}this.pending.clear();}
  stopClient(){
    for(const name of ['connectTimer','deviceTimer','freshTimer','retryTimer','subscribeTimer'])this.clearTimer(name);
    const old=this.client;this.client=null;this.state=null;this.received=0;this.syncIds.clear();
    this.rejectPending('Connection interrupted. Check the conversation before sending again.');
    if(old)old.end(true);
  }
  disconnect(){++this.generation;this.stopClient();this.settings=null;this.setStatus('idle','Disconnected');this.ready();}
  connect(settings){
    const config=BuddyRelayTransport.config(settings.host,settings.device,settings.username,settings.password);
    ++this.generation;this.stopClient();this.settings=config;this.base='deskbuddy/'+config.device;this.attempts=0;this.everReady=false;this.open(this.generation);
  }
  retry(){if(this.settings){this.connect(this.settings);return true;}return false;}
  fail(code,message){++this.generation;this.stopClient();this.setStatus(code,message);this.ready();}
  networkLost(generation){
    if(generation!==this.generation||!this.settings)return;
    this.stopClient();
    if(globalThis.navigator?.onLine===false){this.setStatus('offline','Your phone is offline.');this.ready();return;}
    if(!this.everReady||this.attempts>=3){this.setStatus('network_error','Couldn’t reach the message service. Try again.');this.ready();return;}
    const delay=[1000,3000,8000][this.attempts++];
    this.setStatus('reconnecting','Connection lost. Reconnecting…');this.ready();
    this.retryTimer=this.timers.setTimeout(()=>this.open(generation),delay);
  }
  open(generation){
    if(generation!==this.generation)return;
    if(globalThis.navigator?.onLine===false){this.setStatus('offline','Your phone is offline.');return;}
    this.setStatus(this.attempts?'reconnecting':'connecting',this.attempts?'Reconnecting…':'Making a secure connection…');
    let client;
    try{client=this.mqtt.connect('wss://'+this.settings.host+':8084/mqtt',{
      username:this.settings.username,password:this.settings.password,clientId:'buddy-phone-'+this.id(),
      // MQTT.js auto timers create a blob Worker, blocked by our strict CSP.
      // Native timers work in Safari without weakening the site's security policy.
      timerVariant:'native',forceNativeWebSocket:true,
      protocolVersion:4,clean:true,keepalive:30,connectTimeout:10000,reconnectPeriod:0,reconnectOnConnackError:false,queueQoSZero:false,
    });}catch{this.networkLost(generation);return;}
    this.client=client;const current=()=>this.client===client&&this.generation===generation;
    this.connectTimer=this.timers.setTimeout(()=>{if(current())this.networkLost(generation);},12000);
    client.on('connect',()=>{
      if(!current())return;this.clearTimer('connectTimer');this.setStatus('finding','Finding your Buddy…');
      this.subscribeTimer=this.timers.setTimeout(()=>{if(current())this.fail('permission_error','The message service did not confirm access. Check permissions.');},8000);
      client.subscribe([this.base+'/state',this.base+'/ack',this.base+'/presence'],{qos:0},(error,grants)=>{
        if(!current())return;this.clearTimer('subscribeTimer');
        if(error||!Array.isArray(grants)||grants.length!==3||grants.some(item=>item.qos>=128)){this.fail('permission_error','This login cannot access Buddy. Check its topic permissions.');return;}
        this.sync();
        this.deviceTimer=this.timers.setTimeout(()=>{if(current()&&!this.state)this.setStatus('buddy_offline','Login worked. Buddy isn’t responding yet.');},22000);
        this.watchFreshness(generation,client);
      });
    });
    client.on('packetreceive',packet=>{
      if(!current()||packet.cmd!=='connack')return;
      const refusal=BuddyRelayTransport.refusal(packet);if(refusal)this.fail(refusal.code,refusal.message);
    });
    client.on('error',error=>{
      if(!current())return;const refusal=BuddyRelayTransport.refusal(error);
      if(refusal)this.fail(refusal.code,refusal.message);
      else this.networkLost(generation);
    });
    client.on('close',()=>{if(current())this.networkLost(generation);});
    client.on('message',(topic,payload,packet)=>{if(current())this.message(topic,payload,packet);});
  }
  watchFreshness(generation,client){
    this.clearTimer('freshTimer');
    this.freshTimer=this.timers.setTimeout(()=>{
      if(this.generation!==generation||this.client!==client)return;
      if(this.state&&this.now()-this.received>35000){this.state=null;this.received=0;this.setStatus('buddy_offline','Buddy went quiet. Check its power and Wi-Fi.');this.ready();this.sync();}
      this.watchFreshness(generation,client);
    },5000);
  }
  sync(){
    if(!this.client?.connected)return;
    const rid=this.id();if(this.syncIds.size>4)this.syncIds.clear();this.syncIds.add(rid);
    try{this.client.publish(this.base+'/command',JSON.stringify({v:1,rid,op:'sync',expires:Math.floor(this.now()/1000)+15}),{qos:0,retain:false});}catch{}
  }
  message(topic,payload,packet={}){
    let data;try{if(payload.length>12288)return;data=JSON.parse(payload.toString());}catch{return;}
    if(!data||typeof data!=='object'||Array.isArray(data))return;
    if(topic===this.base+'/presence'&&data.online===false){
      this.state=null;this.received=0;this.rejectPending('Buddy went offline. Check the conversation before retrying.');
      this.setStatus('buddy_offline','Buddy is offline. Check its power and Wi-Fi.');this.ready();return;
    }
    if(packet.retain)return;
    if(topic===this.base+'/state'){
      if(!Number.isSafeInteger(data.boot_id)||data.boot_id<0||data.boot_id>0xffffffff||!Number.isSafeInteger(data.id)||data.id<0||typeof data.busy!=='boolean')return;
      if(!Number.isFinite(data.relay_epoch)||Math.abs(this.now()/1000-data.relay_epoch)>60){this.state=null;this.clearTimer('deviceTimer');this.setStatus('clock_error','Check your phone’s automatic date and time.');this.ready();return;}
      if(this.state&&this.state.boot_id!==data.boot_id)this.rejectPending('Buddy restarted. Check the conversation before retrying.');
      this.state=data;this.received=this.now();this.attempts=0;this.everReady=true;this.clearTimer('deviceTimer');
      this.setStatus(data.configured&&data.available?'ready':'buddy_setup',data.configured&&data.available?'Connected to Buddy':'Buddy is online, but its chat needs setup.');this.ready();
    }else if(topic===this.base+'/ack'){
      if(this.syncIds.has(data.rid)){
        this.syncIds.delete(data.rid);
        if(data.ok===false&&/expired|clock/i.test(data.error||'')){this.state=null;this.clearTimer('deviceTimer');this.setStatus('clock_error','Check your phone’s automatic date and time.');this.ready();}
        return;
      }
      const entry=this.pending.get(data.rid);if(!entry)return;
      this.timers.clearTimeout(entry.timer);this.pending.delete(data.rid);
      if(data.ok===true&&Number.isSafeInteger(data.id)&&data.id>=0)entry.resolve({ok:true,id:data.id});
      else entry.reject(Error(typeof data.error==='string'?data.error:'Buddy could not accept that message.'));
    }
  }
  async request(path,body){
    if(path!=='/api/chat')throw Error('Unsupported request.');
    if(!this.client?.connected)throw Error(this.status.message);
    if(!this.state||this.now()-this.received>35000){this.sync();throw Error('Buddy isn’t responding. Check its power and Wi-Fi.');}
    if(!body)return{...this.state};
    if(this.status.code!=='ready')throw Error('Buddy’s chat needs setup.');
    if(this.pending.size)throw Error('Waiting for confirmation. Check the conversation before retrying.');
    if(this.state.busy)throw Error('Let Buddy finish first.');
    if(!body.clear&&(typeof body.message!=='string'||!body.message.trim()||new TextEncoder().encode(body.message).length>400))throw Error('Keep your message under 400 bytes.');
    const rid=this.id(),command={v:1,rid,op:'chat',boot:this.state.boot_id,expires:Math.floor(this.now()/1000)+15,...(body.clear?{clear:true}:{message:body.message})};
    return new Promise((resolve,reject)=>{
      const timer=this.timers.setTimeout(()=>{
        this.pending.delete(rid);this.state=null;this.received=0;this.setStatus('finding','Checking whether Buddy received that…');this.ready();this.sync();
        this.clearTimer('deviceTimer');this.deviceTimer=this.timers.setTimeout(()=>{if(!this.state)this.setStatus('buddy_offline','Buddy hasn’t confirmed delivery. Check its connection.');},22000);
        reject(Error('Delivery wasn’t confirmed. Check the conversation before retrying.'));
      },6000);
      this.pending.set(rid,{resolve,reject,timer});
      try{this.client.publish(this.base+'/command',JSON.stringify(command),{qos:0,retain:false},error=>{
        if(!error)return;const entry=this.pending.get(rid);if(!entry)return;
        this.timers.clearTimeout(entry.timer);this.pending.delete(rid);reject(Error('Couldn’t send. Check the conversation before retrying.'));
      });}catch{this.timers.clearTimeout(timer);this.pending.delete(rid);reject(Error('Connection lost while sending. Check the conversation first.'));}
    });
  }
}
globalThis.BuddyRelayTransport=BuddyRelayTransport;
if(typeof module!=='undefined')module.exports={BuddyRelayTransport};

'use strict';
class BuddyRelayTransport {
  constructor({mqtt,notify=()=>{},now=()=>Date.now(),ready=()=>{}}){
    this.mqtt=mqtt;this.notify=notify;this.now=now;this.ready=ready;this.pending=new Map();this.state=null;this.received=0;this.client=null;this.base='';this.generation=0;
  }
  static config(host,device,username,password){
    host=host.trim().toLowerCase();device=device.trim();
    if(!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.emqxsl\.com$/.test(host)||host.includes('..')||host.length>150)throw Error('Copy only your EMQX broker hostname, without https://, a port or /mqtt.');
    if(!/^[a-z0-9][a-z0-9-]{0,31}$/.test(device))throw Error('Buddy ID must use 1–32 lowercase letters, numbers or hyphens.');
    if(!username||!password||username.length>128||password.length>256||/[\x00-\x1f]/.test(username+password))throw Error('Enter your broker username and password.');
    return{host,device,username,password};
  }
  id(){return Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');}
  rejectPending(message){for(const entry of this.pending.values()){clearTimeout(entry.timer);entry.reject(Error(message));}this.pending.clear();}
  disconnect(){
    ++this.generation;const old=this.client;this.client=null;this.state=null;this.received=0;
    this.rejectPending('Connection closed. Check Buddy’s conversation before sending again.');
    if(old)old.end(true);this.notify('Disconnected.');
  }
  connect(settings){
    const config=BuddyRelayTransport.config(settings.host,settings.device,settings.username,settings.password);
    this.disconnect();const generation=this.generation;
    this.base='deskbuddy/'+config.device;
    this.notify('Connecting securely…');
    const client=this.mqtt.connect('wss://'+config.host+':8084/mqtt',{
      username:config.username,password:config.password,clientId:'buddy-phone-'+this.id(),
      protocolVersion:4,clean:true,keepalive:30,connectTimeout:10000,reconnectPeriod:5000,queueQoSZero:false,
    });
    this.client=client;
    const current=()=>this.client===client&&this.generation===generation;
    client.on('connect',()=>{
      if(!current())return;this.state=null;this.received=0;this.notify('Connected to the message service. Looking for Buddy…');
      client.subscribe([this.base+'/state',this.base+'/ack',this.base+'/presence'],{qos:0},(error,grants)=>{
        if(!current())return;
        if(error||grants?.some(item=>item.qos===128)){this.notify('Subscription denied. Check broker permissions.');return;}
        this.sync();
      });
    });
    client.on('message',(topic,payload,packet)=>{if(current())this.message(topic,payload,packet);});
    client.on('close',()=>{if(!current())return;this.state=null;this.received=0;this.rejectPending('Connection lost. Check Buddy’s conversation before sending again.');this.notify('Reconnecting… Keep Buddy powered and online.');this.ready();});
    client.on('error',()=>{if(current())this.notify('Could not connect. Check broker address, username and password.');});
  }
  sync(){
    if(!this.client?.connected)return;
    const command={v:1,rid:this.id(),op:'sync',expires:Math.floor(this.now()/1000)+15};
    this.client.publish(this.base+'/command',JSON.stringify(command),{qos:0,retain:false});
  }
  message(topic,payload,packet={}){
    let data;try{if(payload.length>12288)return;data=JSON.parse(payload.toString());}catch{return;}
    if(!data||typeof data!=='object'||Array.isArray(data))return;
    if(topic===this.base+'/presence'&&data.online===false){this.state=null;this.received=0;this.rejectPending('Buddy went offline. Check its conversation before sending again.');this.notify('Buddy is offline. Keep it powered and connected to Wi-Fi.');this.ready();return;}
    if(packet.retain)return; // A retained old state/ack is never evidence that Buddy is online.
    if(topic===this.base+'/state'){
      if(!Number.isSafeInteger(data.boot_id)||data.boot_id<0||data.boot_id>0xffffffff||!Number.isSafeInteger(data.id)||data.id<0||typeof data.busy!=='boolean')return;
      if(!Number.isFinite(data.relay_epoch)||Math.abs(this.now()/1000-data.relay_epoch)>60){this.notify('Phone and Buddy clocks differ. Enable automatic date and time.');return;}
      if(this.state&&this.state.boot_id!==data.boot_id)this.rejectPending('Buddy restarted. Check the conversation before sending again.');
      this.state=data;this.received=this.now();this.notify('Connected to Buddy. Your laptop can stay off.');this.ready();
    }else if(topic===this.base+'/ack'){
      const entry=this.pending.get(data.rid);if(!entry)return;
      clearTimeout(entry.timer);this.pending.delete(data.rid);
      if(data.ok===true&&Number.isSafeInteger(data.id)&&data.id>=0)entry.resolve({ok:true,id:data.id});
      else entry.reject(Error(typeof data.error==='string'?data.error:'Buddy did not accept that request.'));
    }
  }
  async request(path,body){
    if(path!=='/api/chat')throw Error('This dashboard uses its cloud connection.');
    if(!this.client?.connected)throw Error('Connect your Buddy using the form above.');
    if(!this.state||this.now()-this.received>35000){this.sync();throw Error('Waiting for Buddy. Check its power, Wi-Fi and cloud setup.');}
    if(!body)return{...this.state};
    if(this.pending.size)throw Error('A message is awaiting confirmation. Check Buddy before sending again.');
    if(this.state.busy)throw Error('Buddy is still answering. Wait before sending or clearing.');
    if(!body.clear&&(typeof body.message!=='string'||!body.message.trim()||new TextEncoder().encode(body.message).length>400))throw Error('Use a message of 1–400 UTF-8 bytes.');
    const rid=this.id(),command={v:1,rid,op:'chat',boot:this.state.boot_id,expires:Math.floor(this.now()/1000)+15,...(body.clear?{clear:true}:{message:body.message})};
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(rid);this.sync();reject(Error('Confirmation timed out. Buddy may have received it; check the conversation before sending again.'));},6000);
      this.pending.set(rid,{resolve,reject,timer});
      // QoS 0 plus offline-queue disabled: never defer voice commands until reconnect.
      try{this.client.publish(this.base+'/command',JSON.stringify(command),{qos:0,retain:false},error=>{
        if(!error)return;const entry=this.pending.get(rid);if(!entry)return;
        clearTimeout(entry.timer);this.pending.delete(rid);reject(Error('Message could not be sent. Check Buddy’s conversation before retrying.'));
      });}catch{clearTimeout(timer);this.pending.delete(rid);reject(Error('Connection closed while sending. Check Buddy before retrying.'));}
    });
  }
}
globalThis.BuddyRelayTransport=BuddyRelayTransport;
if(typeof module!=='undefined')module.exports={BuddyRelayTransport};

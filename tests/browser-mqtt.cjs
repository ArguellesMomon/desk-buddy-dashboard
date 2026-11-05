// Run: node tests/browser-mqtt.cjs. Uses only Node's built-in modules.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const settings={host:'sdb7211d.ala.us-east-1.emqxsl.com',device:'mous-buddy',username:'fixture-only',password:'not-a-real-password'};
const settle=async()=>{for(let n=0;n<12;n++)await new Promise(resolve=>setTimeout(resolve,3));};
function harness(){
  const sockets=[],intervals=new Set(),timeouts=new Set();let workers=0;
  const browser={document:{URL:'https://buddy.example/'},navigator:{userAgent:'Safari test fixture',onLine:true},
    crypto:require('node:crypto').webcrypto,TextEncoder,TextDecoder,ArrayBuffer,Uint8Array,Blob,performance,AbortController,AbortSignal,
    URL:class extends URL{static createObjectURL(){return 'blob:https://buddy.example/blocked-by-policy';}static revokeObjectURL(){}},
    Worker:class{constructor(){workers++;throw new DOMException('Worker blocked by Content Security Policy','SecurityError');}},
    setTimeout(fn,ms,...args){const id=setTimeout(fn,ms,...args);timeouts.add(id);return id;},
    clearTimeout(id){clearTimeout(id);timeouts.delete(id);},
    setInterval(fn,ms){const id=setInterval(fn,ms);intervals.add(id);return id;},
    clearInterval(id){clearInterval(id);intervals.delete(id);},
    WebSocket:class extends EventTarget{
      constructor(url,protocols){super();this.url=url;this.protocols=protocols;this.readyState=0;this.OPEN=1;this.bufferedAmount=0;this.sent=[];sockets.push(this);}
      open(){this.readyState=1;this.dispatchEvent(new Event('open'));}
      send(bytes){this.sent.push(Buffer.from(bytes));}
      close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
      packet(bytes){this.dispatchEvent(new MessageEvent('message',{data:new Uint8Array(bytes).buffer}));}
    }};
  browser.window=browser;browser.self=browser;
  const context=vm.createContext(browser);
  for(const name of ['mqtt.min.js','cloud-transport.js'])vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),context,{filename:name});
  return{browser,sockets,get workers(){return workers;},close(){for(const id of intervals)clearInterval(id);for(const id of timeouts)clearTimeout(id);}};
}
function statePacket(state){
  const topic=Buffer.from('deskbuddy/mous-buddy/state'),body=Buffer.from(JSON.stringify(state));
  let length=2+topic.length+body.length,remaining=[];
  do{let byte=length%128;length=Math.floor(length/128);if(length)byte|=128;remaining.push(byte);}while(length);
  return Buffer.concat([Buffer.from([0x30,...remaining,topic.length>>8,topic.length&255]),topic,body]);
}
(async()=>{
  const t=harness();
  try{
    // Prove the old default fails with the shipped library when CSP blocks blob workers.
    const old=t.browser.mqtt.connect('wss://'+settings.host+':8084/mqtt',{manualConnect:true,keepalive:30});
    assert.throws(()=>old._setupKeepaliveManager(),/Worker blocked/);assert.equal(t.workers,1);
    const relay=new t.browser.BuddyRelayTransport({mqtt:t.browser.mqtt});
    try{
      relay.connect(settings);let socket=t.sockets.at(-1);socket.open();await settle();
      assert.equal(socket.sent[0][0],0x10,'real MQTT CONNECT sent');
      socket.packet([0x20,0x02,0x00,0x00]);await settle();
      assert.equal(relay.status.code,'finding');assert.equal(t.workers,1,'fixed connection must never create a worker');
      const subscribe=socket.sent.find(bytes=>(bytes[0]>>4)===8);assert(subscribe);
      let p=1;while(subscribe[p++]&128){}
      socket.packet([0x90,5,subscribe[p],subscribe[p+1],0,0,0]);await settle();
      socket.packet(statePacket({boot_id:42,id:0,busy:false,available:true,configured:true,relay_epoch:Date.now()/1000}));await settle();
      assert.equal(relay.status.code,'ready');assert.equal(relay.state.boot_id,42);assert.equal(t.workers,1);
      // A rejected login must still stop; it must not become a generic network failure.
      relay.disconnect();relay.connect(settings);socket=t.sockets.at(-1);socket.open();await settle();
      socket.packet([0x20,0x02,0x00,0x05]);await settle();
      assert.equal(relay.status.code,'auth_error');assert.equal(relay.client,null);assert.equal(t.workers,1);
    }finally{relay.disconnect();}
  }finally{t.close();}
  console.log('PASS: real browser MQTT bundle reproduces the CSP worker failure; fixed transport completes CONNECT, SUBACK and device state, and preserves wrong-password errors. No real network or credentials used.');
})().catch(error=>{console.error(error);process.exitCode=1;});

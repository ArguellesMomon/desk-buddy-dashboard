'use strict';
class BuddyConnectionStore {
  constructor({indexedDB=globalThis.indexedDB,crypto=globalThis.crypto}={}){this.indexedDB=indexedDB;this.crypto=crypto;}
  async open(){
    if(!this.indexedDB||!this.crypto?.subtle)throw Error('Remembering this device is unavailable in this browser.');
    return new Promise((resolve,reject)=>{
      const request=this.indexedDB.open('buddy-connection',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('link');
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(Error('Browser storage is unavailable.'));
      request.onblocked=()=>reject(Error('Close other Buddy tabs and try again.'));
    });
  }
  async record(value,write=false){
    const db=await this.open();
    try{return await new Promise((resolve,reject)=>{
      const transaction=db.transaction('link',write?'readwrite':'readonly'),store=transaction.objectStore('link');
      const request=write?(value===null?store.delete('saved'):store.put(value,'saved')):store.get('saved');
      let result;request.onsuccess=()=>{result=request.result;};
      transaction.oncomplete=()=>resolve(result);transaction.onerror=()=>reject(Error('Connection could not be saved.'));transaction.onabort=()=>reject(Error('Connection could not be saved.'));
    });}finally{db.close();}
  }
  async save(settings,paused=false){
    const key=await this.crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    const iv=this.crypto.getRandomValues(new Uint8Array(12));
    const sealed=await this.crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(settings)));
    await this.record({v:1,key,iv,sealed,paused},true);
  }
  async load(){
    const value=await this.record();if(!value)return null;
    if(value.v!==1)throw Error('Reconnect to update your saved connection.');
    const plain=await this.crypto.subtle.decrypt({name:'AES-GCM',iv:value.iv},value.key,value.sealed);
    const settings=JSON.parse(new TextDecoder().decode(plain));
    return{settings:BuddyRelayTransport.config(settings.host,settings.device,settings.username,settings.password),paused:!!value.paused};
  }
  async pause(paused){const value=await this.record();if(value)await this.record({...value,paused},true);}
  async forget(){await this.record(null,true);}
}
globalThis.BuddyConnectionStore=BuddyConnectionStore;
if(typeof module!=='undefined')module.exports={BuddyConnectionStore};

'use strict';
const cloudById=id=>document.getElementById(id);
globalThis.buddyCloudTransport=new BuddyRelayTransport({mqtt:globalThis.mqtt,
  notify:message=>{cloudById('cloudNotice').textContent=message;},
  ready:()=>globalThis.dispatchEvent(new Event('buddy-cloud-ready')),
});
cloudById('cloudForm').addEventListener('submit',event=>{
  event.preventDefault();
  try{
    globalThis.buddyCloudTransport.connect({host:cloudById('cloudHost').value,device:cloudById('cloudDevice').value,username:cloudById('cloudUser').value,password:cloudById('cloudPassword').value});
    // Keep credentials only in the live client, never localStorage, source or URLs.
    cloudById('cloudPassword').value='';cloudById('cloudDisconnect').hidden=false;
  }catch(error){cloudById('cloudNotice').textContent=error.message;}
});
cloudById('cloudDisconnect').addEventListener('click',()=>{
  globalThis.buddyCloudTransport.disconnect();cloudById('cloudDisconnect').hidden=true;
  globalThis.dispatchEvent(new Event('buddy-cloud-ready'));
});

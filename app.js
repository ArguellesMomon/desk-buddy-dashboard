'use strict';
const $=id=>document.getElementById(id);
const defaults={host:$('host').value,device:$('device').value,username:$('username').value};
const pages=['landing','connect','chat'],panels=['home','about','faq','connection','voice','forget'];
let page='landing',saved=null,activeSettings=null,candidate=null,connectionTicket=0,storageWork=Promise.resolve(),remembered=false;
let sending=false,voice=null,boot=null,accepted=0,pendingSend=null,unconfirmed=null,rows=new Map(),toastTimer,linked=false;
const store=new BuddyConnectionStore();
const relay=new BuddyRelayTransport({mqtt:globalThis.mqtt,onConnection:updateConnection,ready:()=>{if(relay.state)renderState(relay.state);updateControls();}});
globalThis.buddyApp={relay,store};
function notice(text=''){ $('chatNotice').textContent=text;$('chatNotice').hidden=!text; }
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4000);}
function navigate(path,replace=false){
  path=['/connect','/chat'].includes(path)?path:'/';
  if(path==='/chat'&&!activeSettings&&!saved&&!relay.state)path='/connect';
  voice?.cancel();page=path==='/connect'?'connect':path==='/chat'?'chat':'landing';
  for(const id of pages)$(id).hidden=id!==page;document.body.dataset.page=page;
  if(location.pathname!==path)history[replace?'replaceState':'pushState']({},'',path);
  const heading=$(page).querySelector('h1');heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});
  if(page!=='chat'){document.documentElement.scrollTop=0;document.body.scrollTop=0;}
  $('getStarted').firstChild.textContent=saved||linked?'Back to your Buddy ':'Meet your Buddy ';
  if(page==='chat')scrollConversation();
  updateControls();
}
function updateControls(){
  const ready=relay.status.code==='ready',busy=!!relay.state?.busy||accepted>(relay.state?.id??0),capturing=voice?.isBusy()||false;
  $('send').disabled=!ready||busy||sending||capturing||!$('message').value.trim();
  $('message').readOnly=capturing;
  $('talk').disabled=!voice||!ready||busy||sending||(!capturing&&!!$('message').value.trim());
  $('voiceLanguage').disabled=capturing;
  $('newConversation').disabled=!ready||busy||sending||capturing;
  $('disconnect').disabled=!activeSettings;
  $('forget').disabled=!activeSettings&&!saved&&!remembered;
  for(const button of document.querySelectorAll('[data-prompt]'))button.disabled=!ready||busy||sending||capturing;
}
const connectionHelp={
  auth_error:['Check your login','Use the buddy-phone credential you created in EMQX.'],
  permission_error:['Access needs a check','Allow this login to publish and subscribe to your Buddy topics.'],
  network_error:['Can’t reach the message service','Check your internet, or try another Wi-Fi or mobile network.'],
  offline:['You’re offline','Connect your phone to the internet, then try again.'],
  buddy_offline:['Your login worked','Keep Buddy powered and connected to Wi-Fi. Check that its cloud setup is complete.'],
  clock_error:['Your clocks don’t match','Turn on automatic date and time on your phone.'],
  broker_error:['Connection was refused','Check that your message service is running.'],
  buddy_setup:['Buddy is online','Its Gemini chat needs setup on the ESP32.'],
};
function updateConnection(status){
  const working=['connecting','finding','reconnecting'].includes(status.code),help=connectionHelp[status.code];
  $('connectionProgress').hidden=!working;$('connectionProgressText').textContent=status.message;
  $('connectButton').disabled=working;$('connectButton').firstChild.textContent=working?'Connecting… ':'Connect to Buddy ';
  $('connectionError').hidden=!help;
  if(help){$('connectionErrorTitle').textContent=status.code==='auth_error'?status.message:help[0];$('connectionErrorDetail').textContent=help[1];}
  $('password').setAttribute('aria-invalid',String(status.code==='auth_error'));
  $('connectRetry').hidden=!help||status.code==='auth_error';
  $('chatStatus').dataset.connected=String(status.code==='ready');
  const labels={ready:'Here with you',connecting:'Connecting',finding:'Finding Buddy',reconnecting:'Reconnecting',buddy_offline:'Buddy is offline',offline:'You’re offline',auth_error:'Login needs a check',permission_error:'Access needs a check',network_error:'Connection unavailable',clock_error:'Check phone time',buddy_setup:'Chat setup needed',idle:'Disconnected'};
  $('chatStatusText').textContent=labels[status.code]||'Connection unavailable';
  $('chatBanner').hidden=status.code==='ready';$('chatBannerText').textContent=status.message;
  $('retryChat').hidden=working||status.code==='auth_error'||status.code==='permission_error';
  $('editConnection').hidden=!['auth_error','permission_error','broker_error'].includes(status.code);
  $('settingsConnectionState').textContent=status.message;$('detailStatus').textContent=status.message;
  if(status.code!=='ready'&&voice?.isBusy())voice.cancel('Connection changed. Nothing was sent.');
  if(status.code==='auth_error'&&remembered){
    if(saved)saved.paused=true;
    storageWork=storageWork.catch(()=>{}).then(()=>store.pause(true));storageWork.catch(()=>{});
  }
  if(status.code==='ready'&&candidate){
    linked=true;
    const current=candidate;candidate=null;const ticket=connectionTicket;
    $('password').value='';navigate('/chat');
    if(current.remember){
      storageWork=storageWork.catch(()=>{}).then(()=>store.save(current.settings));
      storageWork.then(()=>{if(ticket!==connectionTicket)return;saved={settings:current.settings,paused:false};remembered=true;details();}).catch(()=>{if(ticket===connectionTicket)toast('Connected for this visit. This browser couldn’t remember Buddy.');});
    }else{
      storageWork=storageWork.catch(()=>{}).then(()=>store.forget());
      storageWork.then(()=>{if(ticket===connectionTicket){saved=null;remembered=false;details();}}).catch(()=>toast('Couldn’t update saved connection. See connection settings.'));
    }
  }
  updateControls();
}
function details(){const config=activeSettings||saved?.settings||defaults;$('detailDevice').textContent=config.device;$('detailHost').textContent=config.host;$('detailUsername').textContent=config.username;$('detailRemembered').textContent=remembered?'On this browser':'This visit only';}
function beginConnection(config,remember){
  config=BuddyRelayTransport.config(config.host,config.device,config.username,config.password);
  ++connectionTicket;activeSettings=config;candidate={settings:config,remember};details();relay.connect(config);
}
function retryConnection(){
  if(!activeSettings&&saved)activeSettings=saved.settings;
  if(!activeSettings){navigate('/connect');return;}
  const wasRemembered=remembered;beginConnection(activeSettings,wasRemembered||$('remember').checked);
}
function editConnection(){
  closeSettings();const config=activeSettings||saved?.settings||defaults;
  $('host').value=config.host;$('device').value=config.device;$('username').value=config.username;$('password').value='';
  ++connectionTicket;candidate=null;relay.disconnect();navigate('/connect');
}
function openSettings(panel='home'){
  voice?.cancel();if(!panels.includes(panel))panel='home';
  const titles={home:'Your space',about:'About Buddy',faq:'A little help',connection:'Connection',voice:'Voice & preferences',forget:'Forget connection'};
  for(const name of panels)$('settings-'+name).hidden=name!==panel;
  $('settingsTitle').textContent=titles[panel];$('settingsBack').hidden=panel==='home';details();
  if(!$('settings').open)$('settings').showModal();$('settings').scrollTop=0;
}
function closeSettings(){$('settings').close();}
function scrollConversation(){const log=$('conversation');log.scrollTop=log.scrollHeight;}
function clearRows(){for(const node of [...$('conversation').children])if(node!==$('emptyChat'))node.remove();rows.clear();pendingSend=null;unconfirmed=null;$('emptyChat').hidden=false;}
function messageNode(kind,text=''){
  $('emptyChat').hidden=true;const box=document.createElement('article');box.className='message '+kind;
  const label=document.createElement('span');label.className='message-label';
  if(kind==='user')label.textContent='You';else{const face=document.createElement('span');face.className='brand-face';face.setAttribute('aria-hidden','true');face.append(document.createElement('i'),document.createElement('i'));label.append(face,document.createTextNode('Buddy'));}
  const body=document.createElement('div');body.className='message-body';body.textContent=text;box.append(label,body);$('conversation').append(box);
  return{box,body};
}
function entryFor(state){
  const key=state.boot_id+':'+state.id;let entry=rows.get(key);
  if(!entry){
    const waiting=pendingSend||unconfirmed;
    if(waiting&&waiting.boot===state.boot_id&&state.id>waiting.baseline&&state.question===waiting.message){entry=waiting.entry;entry.user.box.classList.remove('pending','failed');entry.confirmed=true;
      if(!entry.buddy.box.isConnected)$('conversation').append(entry.buddy.box);
      if($('message').value===waiting.message){$('message').value='';resizeInput();}unconfirmed=null;notice();}
    else entry={user:messageNode('user',state.question),buddy:messageNode('buddy')};
    rows.set(key,entry);
  }
  while(rows.size>20){const [first,value]=rows.entries().next().value;value.user.box.remove();value.buddy.box.remove();rows.delete(first);}
  return entry;
}
function renderState(state){
  if(boot!==null&&boot!==state.boot_id){clearRows();accepted=0;notice('Buddy restarted. A fresh little beginning.');}
  boot=state.boot_id;if(state.id<accepted)return;
  if(!state.question){if(!pendingSend&&!unconfirmed)clearRows();updateControls();return;}
  const nearBottom=$('conversation').scrollHeight-$('conversation').scrollTop-$('conversation').clientHeight<180;
  const entry=entryFor(state),text=state.busy?state.draft:state.reply;
  const mood=state.busy&&!state.draft?'thinking':state.expression||'neutral';
  entry.buddy.box.dataset.mood=mood;$('headerFace').dataset.mood=mood;
  entry.buddy.box.classList.toggle('error',!state.busy&&!!state.error);
  if(text){entry.buddy.body.textContent=text;entry.buddy.body.className='message-body';}
  else if(state.busy){
    entry.buddy.body.replaceChildren();const dots=document.createElement('span');dots.className='typing';for(let i=0;i<3;i++)dots.append(document.createElement('i'));
    const label=document.createElement('span');label.textContent=state.phase==='connecting'?'Getting ready':'Thinking';dots.append(label);entry.buddy.body.append(dots);
  }else entry.buddy.body.textContent=state.error?'Buddy couldn’t finish that reply. Try again in a moment.':'';
  if(!state.busy&&state.confirmed_actions&&state.error)notice('Already completed: '+state.confirmed_actions+'. Check before retrying.');
  $('chatFace').dataset.mood=state.busy&&!state.draft?'thinking':state.expression||'neutral';
  if(state.busy)$('chatStatusText').textContent=state.draft?'Replying to you':'Thinking it through';
  if(nearBottom||entry.confirmed)scrollConversation();updateControls();
}
async function sendMessage(text){
  text=text.trim();if(!text||sending||relay.status.code!=='ready'||relay.state?.busy||accepted>(relay.state?.id??0))return;
  if(new TextEncoder().encode(text).length>400){notice('A little shorter, please — up to 400 bytes.');return;}
  notice();sending=true;const entry={user:messageNode('user',text),buddy:messageNode('buddy'),confirmed:false};entry.user.box.classList.add('pending');
  const pending={message:text,boot:relay.state.boot_id,baseline:relay.state.id,entry};pendingSend=pending;unconfirmed=pending;scrollConversation();updateControls();
  try{
    const reply=await relay.request('/api/chat',{message:text});accepted=reply.id;
    entry.confirmed=true;if(unconfirmed===pending)unconfirmed=null;
    if(!rows.has(boot+':'+reply.id)){rows.set(boot+':'+reply.id,entry);entry.user.box.classList.remove('pending');}
    $('message').value='';resizeInput();relay.sync();
  }catch(error){
    if(!entry.confirmed){entry.user.box.classList.remove('pending');entry.user.box.classList.add('failed');entry.buddy.box.remove();notice(error.message);}
    else{$('message').value='';resizeInput();}
  }finally{if(pendingSend===pending)pendingSend=null;sending=false;updateControls();}
}
function resizeInput(){$('message').style.height='auto';$('message').style.height=Math.min($('message').scrollHeight,126)+'px';}
function initializeVoice(){
  const Recognition=globalThis.SpeechRecognition||globalThis.webkitSpeechRecognition;
  if(!globalThis.isSecureContext||!Recognition){$('voiceHint').textContent='Use keyboard dictation or type a little hello.';return;}
  voice=new BuddyTalkController({Recognition,
    canStart:()=>page==='chat'&&relay.status.code==='ready'&&!relay.state?.busy&&!sending&&!$('message').value.trim()&&!document.hidden&&!$('settings').open,
    onText:text=>{$('message').value=text;resizeInput();},
    onState:state=>{
      const labels={idle:'Hold to talk',requesting:'Allow speech access',listening:'Listening — release to send',captured:'Release to send',finalizing:'Finishing your words…'};
      $('talkLabel').textContent=labels[state];
      $('voiceHint').textContent=state==='requesting'?'Allow access if asked, then hold again.':state==='listening'?'Take your time. Release when you’re done.':state==='finalizing'?'Just catching the last little bit.':'Hold, speak, release. Buddy’s listening.';
      updateControls();
    },
    onSend:text=>{updateControls();sendMessage(text);},
    onError:text=>{$('voiceHint').textContent=text;updateControls();}
  });bindBuddyTalkButton($('talk'),voice,()=>$('voiceLanguage').value);
}
for(const element of document.querySelectorAll('[data-settings]'))element.addEventListener('click',()=>openSettings(element.dataset.settings));
for(const element of document.querySelectorAll('[data-nav]'))element.addEventListener('click',event=>{event.preventDefault();if(page==='connect'&&candidate){++connectionTicket;candidate=null;relay.disconnect();}navigate(element.dataset.nav);});
$('getStarted').addEventListener('click',()=>{if(linked||saved){navigate('/chat');if(relay.status.code!=='ready')retryConnection();}else navigate('/connect');});
$('connectBack').addEventListener('click',()=>{if(candidate){++connectionTicket;candidate=null;relay.disconnect();}navigate(saved?'/chat':'/');});
$('connectForm').addEventListener('submit',event=>{event.preventDefault();try{beginConnection({host:$('host').value,device:$('device').value,username:$('username').value,password:$('password').value},$('remember').checked);}catch(error){$('connectionError').hidden=false;$('connectionErrorTitle').textContent='Check your details';$('connectionErrorDetail').textContent=error.message;}});
$('showPassword').addEventListener('click',()=>{const show=$('password').type==='password';$('password').type=show?'text':'password';$('showPassword').setAttribute('aria-pressed',String(show));$('showPassword').setAttribute('aria-label',show?'Hide password':'Show password');});
for(const id of ['connectRetry','retryChat','settingsRetry'])$(id).addEventListener('click',()=>{if(id==='settingsRetry')closeSettings();retryConnection();});
for(const id of ['editConnection','settingsEdit'])$(id).addEventListener('click',editConnection);
$('closeSettings').addEventListener('click',closeSettings);$('settingsBack').addEventListener('click',()=>openSettings('home'));
$('settings').addEventListener('click',event=>{if(event.target===$('settings')){const r=$('settings').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeSettings();}});
$('messageForm').addEventListener('submit',event=>{event.preventDefault();if(!$('send').disabled)sendMessage($('message').value);});
$('message').addEventListener('input',()=>{resizeInput();updateControls();});$('message').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();if(!$('send').disabled)sendMessage($('message').value);}});
for(const element of document.querySelectorAll('[data-prompt]'))element.addEventListener('click',()=>{if(!element.disabled)sendMessage(element.dataset.prompt);});
$('newConversation').addEventListener('click',async()=>{
  if($('newConversation').disabled)return;sending=true;updateControls();closeSettings();
  try{const response=await relay.request('/api/chat',{clear:true});accepted=response.id;clearRows();notice();relay.sync();toast('A fresh little beginning.');}catch(error){notice(error.message);}finally{sending=false;updateControls();}
});
$('disconnect').addEventListener('click',()=>{
  ++connectionTicket;candidate=null;relay.disconnect();voice?.cancel();closeSettings();
  if(saved)saved.paused=true;
  storageWork=storageWork.catch(()=>{}).then(()=>store.pause(true));storageWork.catch(()=>toast('Couldn’t pause the saved connection. Use Forget to remove it.'));
  navigate('/');toast('Disconnected. Come back whenever.');
});
$('forget').addEventListener('click',()=>openSettings('forget'));
$('confirmForget').addEventListener('click',async()=>{
  ++connectionTicket;candidate=null;relay.disconnect();activeSettings=null;saved=null;remembered=false;linked=false;voice?.cancel();clearRows();boot=null;accepted=0;$('password').value='';closeSettings();navigate('/');
  storageWork=storageWork.catch(()=>{}).then(()=>store.forget());
  try{await storageWork;toast('Saved connection removed.');}catch{toast('Couldn’t remove it. Clear this site’s browser data.');}
});
function savePreferences(){try{localStorage.setItem('buddy-preferences',JSON.stringify({language:$('voiceLanguage').value,gentle:$('reduceMotion').checked}));}catch{}document.body.dataset.gentle=String($('reduceMotion').checked);}
$('voiceLanguage').addEventListener('change',savePreferences);$('reduceMotion').addEventListener('change',savePreferences);
try{const preferences=JSON.parse(localStorage.getItem('buddy-preferences')||'{}');if(['en-US','fil-PH'].includes(preferences.language))$('voiceLanguage').value=preferences.language;$('reduceMotion').checked=!!preferences.gentle;document.body.dataset.gentle=String(!!preferences.gentle);}catch{}
globalThis.addEventListener('popstate',()=>navigate(location.pathname,true));
globalThis.addEventListener('offline',()=>{if(activeSettings)relay.fail('offline','Your phone is offline.');});
globalThis.addEventListener('online',()=>{if(activeSettings&&relay.status.code==='offline')retryConnection();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&activeSettings){if(relay.client?.connected)relay.sync();else if(!['idle','auth_error','permission_error','broker_error'].includes(relay.status.code))retryConnection();}});
function viewport(){if(globalThis.visualViewport)document.documentElement.style.setProperty('--app-height',Math.round(visualViewport.height)+'px');}
globalThis.visualViewport?.addEventListener('resize',viewport);viewport();initializeVoice();
(async()=>{
  const ticket=connectionTicket;
  try{
    const profile=await store.load();if(ticket!==connectionTicket)return;
    if(profile){saved=profile;remembered=true;linked=true;activeSettings=profile.settings;details();
      if(profile.paused)navigate('/',true);else{navigate('/chat',true);beginConnection(profile.settings,true);}
    }else navigate(location.pathname,true);
  }catch{if(ticket===connectionTicket){navigate(location.pathname,true);if(location.pathname!=='/')toast('Connect once to remember Buddy on this browser.');}}
  finally{updateControls();}
})();

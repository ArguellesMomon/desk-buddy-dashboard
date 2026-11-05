'use strict';
const $=id=>document.getElementById(id);
const defaults={host:$('host').value,device:$('device').value,username:$('username').value};
const pages=['landing','connect','chat'],panels=['home','about','faq','connection','voice','forget','learning'];
let page='landing',saved=null,activeSettings=null,candidate=null,connectionTicket=0,storageWork=Promise.resolve(),remembered=false;
let sending=false,voice=null,boot=null,accepted=0,pendingSend=null,unconfirmed=null,rows=new Map(),toastTimer,linked=false;
const store=new BuddyConnectionStore();
const learning=new BuddyLearningLibrary(),chirps=new BuddyChirps();
let reviewId=null,lastSoundKey='',lastReplyAt=0,lastUserActivity=Date.now();
const relay=new BuddyRelayTransport({mqtt:globalThis.mqtt,onConnection:updateConnection,ready:()=>{if(relay.state)renderState(relay.state);updateControls();}});
globalThis.buddyApp={relay,store,learning,chirps};
function notice(text=''){ $('chatNotice').textContent=text;$('chatNotice').hidden=!text; }
function clearVoiceReview(){ $('voiceReview').hidden=true;$('voiceChoices').replaceChildren();$('voiceAlternatives').hidden=true;$('voiceAlternatives').open=false; }
function voiceLanguageName(){return $('voiceLanguage').selectedOptions[0]?.textContent||'English';}
function updateVoicePreference(){
  $('voiceLanguageShortcut').textContent=voiceLanguageName();
  $('voiceLanguageShortcut').setAttribute('aria-label','Dictation language: '+voiceLanguageName()+'. Change voice settings');
  $('voiceLanguageShortcut').title=$('reviewVoice').checked?'Review dictation before sending':'Send complete dictation on release';
}
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4000);}
function navigate(path,replace=false){
  path=['/connect','/chat'].includes(path)?path:'/';
  if(path==='/chat'&&!activeSettings&&!saved&&!relay.state)path='/connect';
  voice?.cancel();page=path==='/connect'?'connect':path==='/chat'?'chat':'landing';
  for(const id of pages)$(id).hidden=id!==page;document.body.dataset.page=page;
  if(location.pathname!==path)history[replace?'replaceState':'pushState']({},'',path);
  const heading=$(page).querySelector('h1');heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});
  if(page!=='chat'){document.documentElement.scrollTop=0;document.body.scrollTop=0;}
  $('getStarted').firstChild.textContent=saved||linked?'Return to Buddy ':'Open Buddy ';
  if(page==='chat')scrollConversation();
  updateControls();
}
function updateControls(){
  const ready=relay.status.code==='ready',busy=!!relay.state?.busy||accepted>(relay.state?.id??0),capturing=voice?.isBusy()||false;
  $('send').disabled=!ready||busy||sending||capturing||!$('message').value.trim();
  $('message').readOnly=capturing;
  $('talk').disabled=!voice||!ready||busy||sending||(!capturing&&!!$('message').value.trim());
  $('voiceLanguage').disabled=capturing;
  $('reviewVoice').disabled=capturing;$('voiceLanguageShortcut').disabled=capturing;
  $('newConversation').disabled=!ready||busy||sending||capturing;
  $('disconnect').disabled=!activeSettings;
  $('forget').disabled=!activeSettings&&!saved&&!remembered;
  for(const button of document.querySelectorAll('[data-prompt]'))button.disabled=!ready||busy||sending||capturing;
  for(const button of document.querySelectorAll('[data-learn]'))button.disabled=!ready||busy||sending||capturing||!$('learningTopic').value;
  $('endLesson').disabled=!ready||busy||sending||capturing;
  if(capturing)chirps.stop();
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
  if(status.code!=='ready')chirps.stop();
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
  const titles={home:'Settings',about:'About Buddy',faq:'Help & FAQs',connection:'Connection',voice:'Voice & preferences',forget:'Forget connection',learning:'Notebook'};
  for(const name of panels)$('settings-'+name).hidden=name!==panel;
  $('settingsTitle').textContent=titles[panel];$('settingsBack').hidden=panel==='home';details();
  if(!$('settings').open)$('settings').showModal();$('settings').scrollTop=0;
  if(panel==='learning')refreshStudy();
}
function closeSettings(){$('settings').close();}
function scrollConversation(){const log=$('conversation');log.scrollTop=log.scrollHeight;}
function clearRows(){for(const node of [...$('conversation').children])if(node!==$('emptyChat'))node.remove();rows.clear();pendingSend=null;unconfirmed=null;$('emptyChat').hidden=false;clearVoiceReview();}
function messageNode(kind,text=''){
  $('emptyChat').hidden=true;const box=document.createElement('article');box.className='message '+kind;
  const label=document.createElement('span');label.className='message-label';
  if(kind==='user')label.textContent='You';else{const face=document.createElement('span');face.className='brand-face';face.setAttribute('aria-hidden','true');face.append(document.createElement('i'),document.createElement('i'));label.append(face,document.createTextNode('Buddy'));}
  const body=document.createElement('div');body.className='message-body';body.textContent=text;
  const status=document.createElement('p');status.className='reply-status';status.hidden=true;
  const detail=document.createElement('details');detail.className='reply-details';detail.hidden=true;
  const summary=document.createElement('summary');summary.textContent='Reply details';const reason=document.createElement('p');detail.append(summary,reason);
  const sources=document.createElement('div');sources.className='reply-sources';sources.hidden=true;
  box.append(label,body,status,detail,sources);$('conversation').append(box);
  return{box,body,status,detail,reason,sources};
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
  const incomingKey=state.boot_id+':'+state.id+':reply';
  if(state.question&&!state.busy&&incomingKey!==lastSoundKey)lastReplyAt=Date.now();
  const liveFace=typeof state.face_expression==='string'?state.face_expression:(state.busy?'thinking':Date.now()-lastReplyAt<30000?state.expression:'neutral');
  $('headerFace').dataset.mood=liveFace;$('chatFace').dataset.mood=liveFace;
  chirps.quiet=!!state.quiet;
  if(chirps.quiet)chirps.stop();
  if(boot!==null&&boot!==state.boot_id){clearRows();accepted=0;notice('Buddy restarted. A fresh little beginning.');}
  boot=state.boot_id;if(state.id<accepted)return;
  if(!state.question){if(!pendingSend&&!unconfirmed)clearRows();updateControls();return;}
  const nearBottom=$('conversation').scrollHeight-$('conversation').scrollTop-$('conversation').clientHeight<180;
  const entry=entryFor(state);
  if(state.busy&&state.phase==='tools'&&!state.draft)entry.lastDraft='';
  if(state.busy&&state.draft)entry.lastDraft=state.draft;
  const result=buddyReplyStatus(state,state.error?entry.lastDraft||'':'');
  const text=state.busy?state.draft:result.text;
  const mood=state.busy&&!state.draft?'thinking':state.expression||'neutral';
  entry.buddy.box.dataset.mood=mood;
  entry.buddy.box.classList.toggle('error',!state.busy&&result.failed);
  entry.buddy.status.hidden=state.busy||!result.failed;
  entry.buddy.status.textContent=result.message;
  entry.buddy.detail.hidden=state.busy||!result.failed;
  entry.buddy.reason.textContent='Code: '+result.code+(state.error?' · '+state.error:'');
  const sourceKey=Array.isArray(state.sources)?JSON.stringify(state.sources.slice(0,3)):null;
  if(sourceKey!==null&&sourceKey!==entry.sourceKey){
    entry.sourceKey=sourceKey;
    entry.buddy.sources.replaceChildren();
    for(const source of state.sources.slice(0,3)){
      try{if(typeof source?.url!=='string'||source.url.length>225)continue;const url=new URL(source.url);
        if(url.protocol!=='https:'||url.username||url.password||url.port||!['www.gmanetwork.com','open-meteo.com'].includes(url.hostname))continue;
        const link=document.createElement('a');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=typeof source.title==='string'?source.title.slice(0,80):'Source';entry.buddy.sources.append(link);
      }catch{}
    }entry.buddy.sources.hidden=!entry.buddy.sources.children.length;
  }
  if(text){entry.buddy.body.textContent=text;entry.buddy.body.className='message-body';}
  else if(state.busy){
    entry.buddy.body.replaceChildren();const dots=document.createElement('span');dots.className='typing';for(let i=0;i<3;i++)dots.append(document.createElement('i'));
    const label=document.createElement('span');label.textContent=state.phase==='connecting'?'Getting ready':state.phase==='lookup'?'Checking sources':'Thinking';dots.append(label);entry.buddy.body.append(dots);
  }else entry.buddy.body.textContent='';
  if(!state.busy&&state.confirmed_actions&&state.error)notice('Already completed: '+state.confirmed_actions+'. Check before retrying.');
  const soundKey=state.boot_id+':'+state.id+':'+(state.busy?'thinking':'reply');
  if(soundKey!==lastSoundKey){lastSoundKey=soundKey;if(!state.busy)lastReplyAt=Date.now();if(!voice?.isBusy()&&!document.hidden&&(state.busy||state.ok!==false))chirps.play(mood);}
  if(state.busy)$('chatStatusText').textContent=state.draft?'Replying to you':'Thinking it through';
  if(nearBottom||entry.confirmed)scrollConversation();updateControls();
}
async function sendMessage(text){
  text=text.trim();if(!text||sending||relay.status.code!=='ready'||relay.state?.busy||accepted>(relay.state?.id??0))return;
  if(new TextEncoder().encode(text).length>400){notice('A little shorter, please — up to 400 bytes.');return;}
  clearVoiceReview();
  lastUserActivity=Date.now();notice();sending=true;const entry={user:messageNode('user',text),buddy:messageNode('buddy'),confirmed:false};entry.user.box.classList.add('pending');
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
  if(!globalThis.isSecureContext||!Recognition){$('voiceHint').textContent='Type or use keyboard dictation.';return;}
  voice=new BuddyTalkController({Recognition,reviewFirst:()=>$('reviewVoice').checked,
    canStart:()=>page==='chat'&&relay.status.code==='ready'&&!relay.state?.busy&&!sending&&!$('message').value.trim()&&!document.hidden&&!$('settings').open,
    onText:text=>{$('message').value=text;resizeInput();},
    onState:state=>{
      if(state==='requesting'){clearVoiceReview();notice();}
      const labels={idle:'Hold to talk',requesting:'Starting mic',listening:'Listening',captured:'Stopped early',finalizing:'Finishing…'};
      $('talkLabel').textContent=labels[state];
      $('voiceHint').textContent=state==='requesting'?'Wait for Listening before speaking.':state==='listening'?voiceLanguageName()+' · Slide away to cancel.':state==='captured'?'Recognition ended. Release to review.':state==='finalizing'?'Waiting for the final words.':$('reviewVoice').checked?'Hold, speak, release to review.':'Hold, speak, release to send.';
      updateControls();
    },
    onSend:text=>{updateControls();sendMessage(text);},
    onReview:({reason,alternatives})=>{
      const messages={unfinished:'The last words weren’t finalized. Check the full sentence before sending.',interrupted:'Recognition stopped before you released. Check for missing words.',length:'Shorten this dictation to fit a message before sending.',uncertain:'The speech service was unsure about some words. Check them before sending.',review:'Edit anything Safari misheard, then press Send.'};
      $('voiceReviewText').textContent=messages[reason]||messages.review;$('voiceReview').hidden=false;
      $('voiceChoices').replaceChildren();
      for(const text of alternatives){const button=document.createElement('button');button.type='button';button.className='voice-choice';button.textContent=text;
        button.addEventListener('click',()=>{$('message').value=text;resizeInput();updateControls();$('voiceReviewText').textContent='Alternative selected. Check it, then press Send.';});$('voiceChoices').append(button);}
      $('voiceAlternatives').hidden=!alternatives.length;
      $('voiceHint').textContent='Dictation kept for review. Nothing sent.';updateControls();
    },
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
$('conversationNav').addEventListener('click',()=>{$('message').focus();});
$('closeSettings').addEventListener('click',closeSettings);$('settingsBack').addEventListener('click',()=>openSettings('home'));
$('settings').addEventListener('click',event=>{if(event.target===$('settings')){const r=$('settings').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeSettings();}});
$('messageForm').addEventListener('submit',event=>{event.preventDefault();if(!$('send').disabled)sendMessage($('message').value);});
$('message').addEventListener('input',()=>{if(!$('message').value.trim())clearVoiceReview();resizeInput();updateControls();});$('message').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();if(!$('send').disabled)sendMessage($('message').value);}});
for(const element of document.querySelectorAll('[data-prompt]'))element.addEventListener('click',()=>{if(!element.disabled)sendMessage(element.dataset.prompt);});
$('newConversation').addEventListener('click',async()=>{
  if($('newConversation').disabled)return;sending=true;updateControls();closeSettings();
  try{const response=await relay.request('/api/chat',{clear:true});accepted=response.id;clearRows();notice();relay.sync();toast('New conversation started.');}catch(error){notice(error.message);}finally{sending=false;updateControls();}
});
$('disconnect').addEventListener('click',()=>{
  ++connectionTicket;candidate=null;relay.disconnect();voice?.cancel();closeSettings();
  if(saved)saved.paused=true;
  storageWork=storageWork.catch(()=>{}).then(()=>store.pause(true));storageWork.catch(()=>toast('Couldn’t pause the saved connection. Use Forget to remove it.'));
  navigate('/');toast('Disconnected. Your saved connection is kept.');
});
$('forget').addEventListener('click',()=>openSettings('forget'));
$('confirmForget').addEventListener('click',async()=>{
  ++connectionTicket;candidate=null;relay.disconnect();activeSettings=null;saved=null;remembered=false;linked=false;voice?.cancel();clearRows();boot=null;accepted=0;$('password').value='';closeSettings();navigate('/');
  storageWork=storageWork.catch(()=>{}).then(()=>store.forget());
  try{await storageWork;toast('Saved connection removed.');}catch{toast('Couldn’t remove it. Clear this site’s browser data.');}
});
function savePreferences(){try{localStorage.setItem('buddy-preferences',JSON.stringify({language:$('voiceLanguage').value,gentle:$('reduceMotion').checked,reviewVoice:$('reviewVoice').checked}));}catch{}document.body.dataset.gentle=String($('reduceMotion').checked);updateVoicePreference();}

function studyNotice(text=''){$('learningNotice').textContent=text;$('learningNotice').hidden=!text;}
function refreshStudy(){
  const selected=$('learningTopic').value;$('learningTopic').replaceChildren();
  if(!learning.data.topics.length){const option=document.createElement('option');option.value='';option.textContent='Add your first topic below';$('learningTopic').append(option);}
  for(const topic of learning.data.topics){const option=document.createElement('option');option.value=topic.id;option.textContent=topic.title+' · '+topic.level;$('learningTopic').append(option);}
  if(learning.data.topics.some(t=>t.id===selected))$('learningTopic').value=selected;
  const topic=$('learningTopic').value,due=learning.due(topic),card=due[0];reviewId=card?.id??null;
  $('reviewCount').textContent=due.length+' due';$('reviewCard').hidden=!card;$('reviewEmpty').hidden=!!card;
  $('reviewAnswer').hidden=true;$('reviewRatings').hidden=true;$('revealAnswer').hidden=false;
  if(card){$('reviewQuestion').textContent=card.q;$('reviewAnswer').textContent=card.a;$('reviewTopic').textContent=learning.data.topics.find(t=>t.id===card.topic)?.title||'';}
  $('removeTopic').disabled=!topic;$('useLastReply').disabled=!relay.state?.reply;
  if(learning.loadError)studyNotice('Study storage is unavailable or unreadable. Existing data is kept; chat still works.');
  updateControls();
}
$('topicForm').addEventListener('submit',event=>{event.preventDefault();try{const id=learning.addTopic($('topicTitle').value,$('topicLevel').value);$('topicTitle').value='';studyNotice('Topic saved. Choose Teach me to begin.');refreshStudy();$('learningTopic').value=id;refreshStudy();}catch(error){studyNotice(error.message||'Couldn’t save this topic.');}});
$('learningTopic').addEventListener('change',()=>{studyNotice();refreshStudy();});
for(const button of document.querySelectorAll('[data-learn]'))button.addEventListener('click',()=>{
  if(button.disabled)return;try{const prompt=learning.prompt($('learningTopic').value,button.dataset.learn);closeSettings();navigate('/chat');sendMessage(prompt);}catch(error){studyNotice(error.message);}
});
$('endLesson').addEventListener('click',()=>{if($('endLesson').disabled)return;closeSettings();navigate('/chat');sendMessage('End learning session.');});
$('revealAnswer').addEventListener('click',()=>{$('reviewAnswer').hidden=false;$('reviewRatings').hidden=false;$('revealAnswer').hidden=true;});
for(const button of document.querySelectorAll('[data-rate]'))button.addEventListener('click',()=>{if(!reviewId||$('reviewAnswer').hidden)return;try{learning.rate(reviewId,button.dataset.rate);studyNotice('Review saved. See you next time.');refreshStudy();}catch(error){studyNotice('Couldn’t save your review. '+error.message);}});
$('useLastReply').addEventListener('click',()=>{if(!relay.state?.reply)return;$('cardQuestion').value=relay.state.question.slice(0,300);$('cardAnswer').value=relay.state.reply.slice(0,1800);studyNotice('Edit this into one clear question and check the answer before saving.');});
$('cardForm').addEventListener('submit',event=>{event.preventDefault();try{learning.addCard($('learningTopic').value,$('cardQuestion').value,$('cardAnswer').value);$('cardQuestion').value='';$('cardAnswer').value='';studyNotice('Card saved on this browser.');refreshStudy();}catch(error){studyNotice('Couldn’t save this card. '+error.message);}});
$('exportLearning').addEventListener('click',()=>{try{const url=URL.createObjectURL(new Blob([learning.export()],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='buddy-study-backup.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}catch{studyNotice('Couldn’t export a backup in this browser.');}});
$('importLearning').addEventListener('change',async()=>{const file=$('importLearning').files?.[0];if(!file)return;try{if(file.size>300000)throw Error('Study file is too large.');learning.import(await file.text());studyNotice('Backup merged.');refreshStudy();}catch(error){studyNotice('Couldn’t import this backup. '+error.message);}finally{$('importLearning').value='';}});
$('removeTopic').addEventListener('click',()=>{if(!$('confirmStudyDelete').checked){studyNotice('Tick Confirm removal first. This also removes the topic’s cards.');return;}try{learning.removeTopic($('learningTopic').value);$('confirmStudyDelete').checked=false;studyNotice('Topic and its cards removed.');refreshStudy();}catch(error){studyNotice(error.message);}});
$('clearLearning').addEventListener('click',()=>{if(!$('confirmStudyDelete').checked){studyNotice('Tick Confirm removal first. Export a backup if you want to keep your library.');return;}try{learning.clear();$('confirmStudyDelete').checked=false;studyNotice('Study library cleared.');refreshStudy();}catch{studyNotice('Couldn’t clear study storage.');}});
$('chirpsEnabled').addEventListener('change',async()=>{if(!$('chirpsEnabled').checked){chirps.enabled=false;chirps.stop();return;}try{await chirps.enable();if(!$('chirpsEnabled').checked){chirps.enabled=false;return;}chirps.play('happy',true);}catch(error){$('chirpsEnabled').checked=false;toast(error.message);}});
$('previewChirp').addEventListener('click',async()=>{try{await chirps.enable();$('chirpsEnabled').checked=true;chirps.play('happy',true);}catch(error){toast(error.message);}});
document.addEventListener('pointerdown',()=>{lastUserActivity=Date.now();},{passive:true});
document.addEventListener('keydown',()=>{lastUserActivity=Date.now();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)chirps.stop();});
// Offline/older firmware fallback is cosmetic and never sends a command to the device.
setInterval(()=>{if(document.hidden||relay.status.code!=='ready'||relay.state?.face_expression||relay.state?.busy||voice?.isBusy()||$('settings').open)return;const idle=Date.now()-lastUserActivity;if(idle<30000)return;const mood=idle>=180000?'sleeping':idle>=120000?'sleepy':idle>=45000?'bored':'neutral';$('headerFace').dataset.mood=mood;$('chatFace').dataset.mood=mood;},5000);
$('voiceLanguage').addEventListener('change',savePreferences);$('reduceMotion').addEventListener('change',savePreferences);$('reviewVoice').addEventListener('change',savePreferences);
try{const preferences=JSON.parse(localStorage.getItem('buddy-preferences')||'{}');if(['en-US','fil-PH'].includes(preferences.language))$('voiceLanguage').value=preferences.language;$('reviewVoice').checked=!!preferences.reviewVoice;$('reduceMotion').checked=!!preferences.gentle;document.body.dataset.gentle=String(!!preferences.gentle);}catch{}
updateVoicePreference();
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

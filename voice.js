'use strict';

class BuddyTalkController {
  constructor(options){this.options=options;this.current=null;}
  isBusy(){return this.current!==null;}
  state(value){this.options.onState?.(value);}
  text(session,finalOnly=false){return session.results.filter(item=>!finalOnly||item.final).map(item=>item.text.trim()).filter(Boolean).join(' ').trim();}
  start(language){
    if(this.current||!this.options.canStart())return false;
    const session={held:true,started:false,ended:false,sent:false,results:[]};
    this.current=session;
    try{
      const recognition=new this.options.Recognition();session.recognition=recognition;
      recognition.lang=language||'en-US';recognition.continuous=true;recognition.interimResults=true;recognition.maxAlternatives=1;
      recognition.onstart=()=>{
        if(this.current!==session||!session.held){try{recognition.abort();}catch{}return;}
        session.started=true;clearTimeout(session.startTimer);this.state('listening');
        session.holdTimer=setTimeout(()=>this.cancel('Voice reached its 30-second limit. Shorten the captured words and send them manually.'),30000);
      };
      recognition.onresult=event=>{
        if(this.current!==session)return;
        session.results=[];
        for(let i=0;i<event.results.length;i++){
          const result=event.results[i],text=result?.[0]?.transcript;
          if(typeof text==='string')session.results.push({text,final:!!result.isFinal});
        }
        this.options.onText?.(this.text(session));
      };
      recognition.onerror=event=>{
        if(this.current!==session)return;
        const errors={'not-allowed':'Speech access was blocked. Allow microphone/speech recognition for this page in Safari.',
          'service-not-allowed':'Speech recognition is unavailable. Check Siri and Dictation settings.',
          'audio-capture':'The microphone could not be opened. Check whether another app is using it.',
          'no-speech':'No speech was detected. Hold the button and try again.',
          'network':'The phone speech service could not connect. Check its internet connection.',
          'language-not-supported':'This phone does not support that voice language. Try English or keyboard dictation.'};
        this.cancel(errors[event.error]||'Speech recognition stopped. Your captured words were kept for editing.');
      };
      recognition.onend=()=>{
        if(this.current!==session)return;
        session.ended=true;clearTimeout(session.holdTimer);
        if(!session.held)this.finish(session);else this.state('captured');
      };
      this.state('requesting');
      session.startTimer=setTimeout(()=>this.cancel('Speech did not start. Check Safari speech permission, then hold again.'),15000);
      recognition.start();return true;
    }catch{this.cancel('Speech recognition could not start in this browser.');return false;}
  }
  release(){
    const session=this.current;if(!session||!session.held)return;
    session.held=false;clearTimeout(session.startTimer);clearTimeout(session.holdTimer);
    if(!session.started){this.cancel('After allowing speech access, hold the button again to speak.');return;}
    this.state('finalizing');
    if(session.ended){this.finish(session);return;}
    session.endTimer=setTimeout(()=>this.cancel('The phone did not finish recognizing the words. Review the captured text and send it manually.'),5000);
    try{session.recognition.stop();}catch{this.cancel('Speech could not finish. Captured words were kept for editing.');}
  }
  finish(session){
    if(this.current!==session||session.held||session.sent)return;
    const text=this.text(session,true);session.sent=true;
    this.cleanup(session);this.current=null;this.state('idle');
    if(!text){this.options.onError?.('No completed speech was recognized. Try again or use the message box.');return;}
    this.options.onText?.(text);this.options.onSend?.(text);
  }
  cleanup(session){clearTimeout(session.startTimer);clearTimeout(session.holdTimer);clearTimeout(session.endTimer);}
  cancel(message='Voice cancelled. Nothing was sent.'){
    const session=this.current;if(!session)return;
    this.current=null;this.cleanup(session);
    try{session.recognition?.abort();}catch{}
    this.state('idle');this.options.onError?.(message);
  }
}
function bindBuddyTalkButton(button,controller,language,root=globalThis){
  let active=null;
  function cancel(){if(active){active=null;controller.cancel();}else if(controller.isBusy())controller.cancel();button.setAttribute('aria-pressed','false');}
  function release(){if(!active)return;active=null;button.setAttribute('aria-pressed','false');controller.release();}
  button.addEventListener('pointerdown',event=>{
    if(button.disabled||active||event.button!==0)return;event.preventDefault();
    if(controller.start(language())){active={pointer:event.pointerId};button.setAttribute('aria-pressed','true');try{button.setPointerCapture(event.pointerId);}catch{}}
  });
  root.addEventListener('pointerup',event=>{if(active?.pointer===event.pointerId)release();});
  root.addEventListener('pointercancel',event=>{if(active?.pointer===event.pointerId)cancel();});
  button.addEventListener('lostpointercapture',event=>{if(active?.pointer===event.pointerId)cancel();});
  button.addEventListener('keydown',event=>{
    if(![' ','Enter'].includes(event.key)||event.repeat||button.disabled||active)return;event.preventDefault();
    if(controller.start(language())){active={key:event.key};button.setAttribute('aria-pressed','true');}
  });
  root.addEventListener('keyup',event=>{if(active?.key===event.key){event.preventDefault();release();}});
  root.addEventListener('keydown',event=>{if(event.key==='Escape')cancel();});
  root.addEventListener('blur',cancel);
  root.document.addEventListener('visibilitychange',()=>{if(root.document.hidden)cancel();});
  button.addEventListener('click',event=>event.preventDefault());
  button.addEventListener('contextmenu',event=>event.preventDefault());
  return cancel;
}

globalThis.BuddyTalkController=BuddyTalkController;
globalThis.bindBuddyTalkButton=bindBuddyTalkButton;

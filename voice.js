'use strict';

class BuddyTalkController {
  constructor(options){this.options=options;this.current=null;}
  isBusy(){return this.current!==null;}
  state(value){this.options.onState?.(value);}
  text(session,finalOnly=false){return session.results.filter(item=>!finalOnly||item.final).map(item=>item.text.trim()).filter(Boolean).join(' ').trim();}
  alternatives(session){
    const choices=[],base=this.text(session),seen=new Set([base.toLocaleLowerCase()]);
    // Whole-utterance alternatives, changing one returned segment at a time.
    // Keep the recognizer's top choice; never invent corrections or rewrite names/numbers.
    for(let i=0;i<session.results.length&&choices.length<3;i++){
      for(const alternative of session.results[i].alternatives){
        const text=session.results.map((item,index)=>index===i?alternative:item.text).join(' ').trim();
        const key=text.toLocaleLowerCase();if(!seen.has(key)&&text.length<=1600){seen.add(key);choices.push(text);}
        if(choices.length>=3)break;
      }
    }return choices;
  }
  start(language){
    if(this.current||!this.options.canStart())return false;
    const session={held:true,started:false,ended:false,sent:false,results:[],unresolved:null,interrupted:false,review:!!this.options.reviewFirst?.()};
    this.current=session;
    try{
      const recognition=new this.options.Recognition();session.recognition=recognition;
      recognition.lang=language||'en-US';recognition.continuous=true;recognition.interimResults=true;recognition.maxAlternatives=3;
      recognition.onstart=()=>{
        if(this.current!==session||!session.held){try{recognition.abort();}catch{}return;}
        session.started=true;clearTimeout(session.startTimer);this.state('listening');
        session.holdTimer=setTimeout(()=>this.cancel('Voice reached its 30-second limit. Shorten the captured words and send them manually.'),30000);
      };
      recognition.onresult=event=>{
        if(this.current!==session)return;
        if(!event.results||event.results.length>100){this.cancel('Speech result was too large. Review the captured words.');return;}
        const results=[];
        for(let i=0;i<event.results.length;i++){
          const result=event.results[i],top=result?.[0],text=top?.transcript;
          if(typeof text!=='string')continue;
          const confidence=typeof top.confidence==='number'&&Number.isFinite(top.confidence)&&top.confidence>0&&top.confidence<=1?top.confidence:null;
          const alternatives=[];
          for(let n=1;n<Math.min(result.length||0,3);n++){const other=result[n]?.transcript;if(typeof other==='string'&&other.trim())alternatives.push(other.trim());}
          results.push({text:text.trim(),final:!!result.isFinal,confidence,alternatives});
        }
        session.results=results;const text=this.text(session),finalCount=results.filter(item=>item.final).length;
        if(results.some(item=>!item.final))session.unresolved={text,finalCount};
        else if(session.unresolved&&finalCount>session.unresolved.finalCount)session.unresolved=null;
        // Browsers can retract interim words at the end. Keep them available for
        // editing instead of silently sending only the committed prefix.
        this.options.onText?.(session.unresolved?.text||text);
        if(text.length>1600){this.cancel('Voice message is too long. Shorten the captured text before sending.');return;}
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
        if(!session.held)this.finish(session);else{session.interrupted=true;this.state('captured');}
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
    const final=this.text(session,true),text=session.unresolved?.text||final;
    const lowConfidence=session.results.some(item=>item.final&&item.confidence!==null&&item.confidence<.75);
    const tooLong=new TextEncoder().encode(text).length>400;
    const reason=session.unresolved?'unfinished':session.interrupted?'interrupted':tooLong?'length':lowConfidence?'uncertain':session.review?'review':null;
    const alternatives=this.alternatives(session);session.sent=true;
    this.cleanup(session);this.current=null;this.state('idle');
    if(!text){this.options.onError?.('No completed speech was recognized. Try again or use the message box.');return;}
    this.options.onText?.(text);
    if(reason){this.options.onReview?.({reason,alternatives:session.unresolved?[]:alternatives});return;}
    this.options.onSend?.(text);
  }
  cleanup(session){clearTimeout(session.startTimer);clearTimeout(session.holdTimer);clearTimeout(session.endTimer);}
  cancel(message='Voice cancelled. Nothing was sent.',discard=false){
    const session=this.current;if(!session)return;
    this.current=null;this.cleanup(session);
    try{session.recognition?.abort();}catch{}
    if(discard)this.options.onText?.('');
    this.state('idle');this.options.onError?.(message);
  }
}
function bindBuddyTalkButton(button,controller,language,root=globalThis){
  let active=null;
  function cancel(message='Voice cancelled. Nothing was sent.',discard=false){
    const previous=active;active=null;button.setAttribute('aria-pressed','false');
    // Clear active before releasing capture: lostpointercapture must not cancel twice.
    try{if(previous?.pointer!==undefined)button.releasePointerCapture(previous.pointer);}catch{}
    if(controller.isBusy())controller.cancel(message,discard);
  }
  function outside(event){
    if(!Number.isFinite(event.clientX)||!Number.isFinite(event.clientY))return false;
    const rect=button.getBoundingClientRect();if(rect.width<=0||rect.height<=0)return false;
    // Small tolerance for natural finger drift; once cancelled, moving back cannot send.
    return event.clientX<rect.left-12||event.clientX>rect.right+12||event.clientY<rect.top-12||event.clientY>rect.bottom+12;
  }
  function release(){if(!active)return;active=null;button.setAttribute('aria-pressed','false');controller.release();}
  button.addEventListener('pointerdown',event=>{
    if(button.disabled||active||event.button!==0)return;event.preventDefault();
    if(controller.start(language())){active={pointer:event.pointerId};button.setAttribute('aria-pressed','true');try{button.setPointerCapture(event.pointerId);}catch{}}
  });
  root.addEventListener('pointermove',event=>{if(active?.pointer===event.pointerId&&outside(event))cancel('Recording cancelled. Nothing sent.',true);});
  root.addEventListener('pointerup',event=>{if(active?.pointer===event.pointerId){if(outside(event))cancel('Recording cancelled. Nothing sent.',true);else release();}});
  root.addEventListener('pointercancel',event=>{if(active?.pointer===event.pointerId)cancel('Recording cancelled. Nothing sent.',true);});
  button.addEventListener('lostpointercapture',event=>{if(active?.pointer===event.pointerId)cancel('Recording cancelled. Nothing sent.',true);});
  button.addEventListener('keydown',event=>{
    if(![' ','Enter'].includes(event.key)||event.repeat||button.disabled||active)return;event.preventDefault();
    if(controller.start(language())){active={key:event.key};button.setAttribute('aria-pressed','true');}
  });
  root.addEventListener('keyup',event=>{if(active?.key===event.key){event.preventDefault();release();}});
  root.addEventListener('keydown',event=>{if(event.key==='Escape')cancel('Recording cancelled. Nothing sent.',true);});
  root.addEventListener('blur',()=>cancel());
  root.document.addEventListener('visibilitychange',()=>{if(root.document.hidden)cancel();});
  button.addEventListener('click',event=>event.preventDefault());
  button.addEventListener('contextmenu',event=>event.preventDefault());
  return cancel;
}

globalThis.BuddyTalkController=BuddyTalkController;
globalThis.bindBuddyTalkButton=bindBuddyTalkButton;

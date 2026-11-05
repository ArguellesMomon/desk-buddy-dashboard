// Deterministic recognizer and pointer tests. No audio, permissions or network.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../voice.js'),'utf8');
function harness(review=false){
 let timerId=0;const timers=new Map(),engines=[],texts=[],sends=[],reviews=[],errors=[],states=[];
 class Recognition{constructor(){engines.push(this);}start(){}stop(){this.stopped=true;}abort(){this.aborted=true;this.onend?.();}}
 const context={TextEncoder,setTimeout:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId;},clearTimeout:id=>timers.delete(id)};
 vm.createContext(context);vm.runInContext(source,context);
 const controller=new context.BuddyTalkController({Recognition,canStart:()=>true,reviewFirst:()=>review,onText:t=>texts.push(t),onSend:t=>sends.push(t),onReview:r=>reviews.push(r),onError:e=>errors.push(e),onState:s=>states.push(s)});
 return{controller,context,engines,texts,sends,reviews,errors,states,timers,tick(delay){for(const [id,timer] of [...timers])if(timer.delay===delay){timers.delete(id);timer.fn();}},begin(){assert(controller.start('en-US'));const engine=engines.at(-1);engine.onstart();return engine;}};
}
function result(text,final=true,confidence=.95,alternatives=[]){if(arguments.length>=3)confidence=arguments[2];const value=[{transcript:text,confidence},...alternatives.map(transcript=>({transcript}))];value.isFinal=final;return value;}
function finish(t,e){t.controller.release();e.onend();}
{
 const t=harness(),e=t.begin();assert.equal(e.lang,'en-US');assert(e.continuous&&e.interimResults);assert.equal(e.maxAlternatives,3);
 e.onresult({results:[result('Explain it',false)]});e.onresult({results:[result('Explain it again',true)]});finish(t,e);e.onend();
 assert.deepEqual(t.sends,['Explain it again']);assert.equal(t.reviews.length,0);assert.equal(t.timers.size,0);
}
{
 const t=harness(),e=t.begin();e.onresult({results:[result('Explain',true),result('it again',false)]});
 // Safari retracts the unfinished suffix. The old implementation sent "Explain".
 e.onresult({results:[result('Explain',true)]});finish(t,e);
 assert.equal(t.sends.length,0);assert.equal(t.reviews[0].reason,'unfinished');assert.equal(t.texts.at(-1),'Explain it again');
}
{
 const t=harness(),e=t.begin();e.onresult({results:[result('Explain',true),result('it',false)]});e.onresult({results:[result('Explain',true),result('it again',true)]});finish(t,e);
 assert.deepEqual(t.sends,['Explain it again']);
}
{
 const t=harness(),e=t.begin();e.onresult({results:[result('Let us play it again',true,.4,['Explain it again'])]});finish(t,e);
 assert.equal(t.sends.length,0);assert.equal(t.reviews[0].reason,'uncertain');assert.deepEqual([...t.reviews[0].alternatives],['Explain it again']);assert.equal(t.texts.at(-1),'Let us play it again','Never silently rewrite the user’s intent');
}
{
 const t=harness(true),e=t.begin();e.onresult({results:[result("Let's play it again",true,.99,['Explain it again'])]});finish(t,e);
 assert.equal(t.sends.length,0);assert.equal(t.reviews[0].reason,'review');assert.equal(t.texts.at(-1),"Let's play it again");
}
for(const confidence of [0,undefined,NaN]){
 const t=harness(),e=t.begin();e.onresult({results:[result('Very very good',true,confidence)]});finish(t,e);assert.deepEqual(t.sends,['Very very good'],'Missing/placeholder confidence is not a calibrated accuracy score');
}
{
 const t=harness(),e=t.begin();e.onresult({results:[result('Explain it again')]});e.onend();assert.equal(t.states.at(-1),'captured');assert.equal(t.sends.length,0);t.controller.release();assert.equal(t.reviews[0].reason,'interrupted');
}
{
 const t=harness(),e=t.begin();e.onresult({results:[result('Some draft',false)]});t.controller.cancel('Cancelled',true);e.onresult({results:[result('Late final')]});e.onend();t.controller.release();
 assert.equal(t.texts.at(-1),'');assert.equal(t.sends.length,0);assert.equal(t.timers.size,0);assert(e.aborted);
}
{
 const t=harness();t.controller.start();const e=t.engines[0];t.controller.release();e.onstart();assert.equal(t.sends.length,0);assert.equal(t.controller.isBusy(),false);
}
for(const code of ['not-allowed','no-speech','network','audio-capture']){
 const t=harness(),e=t.begin();e.onresult({results:[result('Draft only',false)]});e.onerror({error:code});e.onend();t.controller.release();assert.equal(t.sends.length,0);assert.equal(t.texts.at(-1),'Draft only');assert(t.errors.length);
}
{
 const t=harness(),e=t.begin();e.onresult({results:[result('Keep these words',false)]});t.controller.release();t.tick(5000);assert.equal(t.sends.length,0);assert.equal(t.texts.at(-1),'Keep these words');assert.equal(t.controller.isBusy(),false);
}
{
 const t=harness(),e=t.begin();e.onresult({results:[result('é'.repeat(210))]});finish(t,e);assert.equal(t.sends.length,0);assert.equal(t.reviews[0].reason,'length');
}
class Target{
 constructor(){this.listeners=new Map();this.attributes={};this.disabled=false;}
 addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(fn);}
 fire(name,event={}){for(const fn of this.listeners.get(name)||[])fn({preventDefault(){},...event});}
 setAttribute(name,value){this.attributes[name]=value;}
 getBoundingClientRect(){return{left:100,right:260,top:400,bottom:444,width:160,height:44};}
 setPointerCapture(){}releasePointerCapture(){this.fire('lostpointercapture',{pointerId:7});}
}
function pointer(t){const button=new Target(),root=new Target();root.document=new Target();t.context.bindBuddyTalkButton(button,t.controller,()=>'en-US',root);return{button,root,down(){button.fire('pointerdown',{button:0,pointerId:7,clientX:180,clientY:420});t.engines.at(-1).onstart();},up(x=180,y=420){root.fire('pointerup',{pointerId:7,clientX:x,clientY:y});}};}
{
 const t=harness(),p=pointer(t);p.down();const e=t.engines[0];e.onresult({results:[result('Draft that must not send')]});p.root.fire('pointermove',{pointerId:7,clientX:50,clientY:350});
 assert.equal(p.button.attributes['aria-pressed'],'false');assert.equal(t.texts.at(-1),'');assert(e.aborted);p.root.fire('pointermove',{pointerId:7,clientX:180,clientY:420});p.up();e.onend();assert.equal(t.sends.length,0,'Moving back after cancel never resumes/sends');
}
{
 const t=harness(),p=pointer(t);p.down();const e=t.engines[0];e.onresult({results:[result('Explain it again')]});p.root.fire('pointermove',{pointerId:8,clientX:0,clientY:0});p.root.fire('pointermove',{pointerId:7,clientX:265,clientY:420});p.up();e.onend();assert.deepEqual(t.sends,['Explain it again'],'Small drift and other fingers do not cancel');
}
{
 const t=harness(),p=pointer(t);p.down();const e=t.engines[0];e.onresult({results:[result('Do not send')]});p.up(0,0);e.onend();assert.equal(t.sends.length,0,'Release outside cancels even without a move event');
}
for(const action of ['pointercancel','lostpointercapture','escape']){
 const t=harness(),p=pointer(t);p.down();const e=t.engines[0];e.onresult({results:[result('Do not send')]});
 if(action==='escape')p.root.fire('keydown',{key:'Escape'});else (action==='pointercancel'?p.root:p.button).fire(action,{pointerId:7});
 p.up();e.onend();assert.equal(t.sends.length,0);assert.equal(t.texts.at(-1),'');
}
console.log('PASS: final/interim assembly, no dropped suffix, review/alternatives, no guessed corrections, early end/error/timeout/UTF-8 bounds, single send, drag-away cancellation, pointer capture and late-event guards.');

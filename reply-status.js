'use strict';
function buddyReplyStatus(state,lastDraft=''){
  const error=typeof state.error==='string'?state.error:'',partialText=typeof state.reply==='string'&&state.reply?state.reply:typeof state.partial==='boolean'?'':lastDraft;
  let code=typeof state.error_code==='string'?state.error_code:'';
  if(!code&&error){const text=error.toUpperCase();code=/FREE LIMIT/.test(text)?'quota':/KEY|ACCESS/.test(text)?'auth':/MEMORY/.test(text)?'memory':/TOO LONG/.test(text)?'length':/BUDGET/.test(text)?'budget':/NO COMPLETE|TIMEOUT/.test(text)?'timeout':/INTERNET TIME/.test(text)?'clock':/INTERRUPTED|CANCELLED/.test(text)?'interrupted':/NETWORK|DISCONNECTED|CONNECTION|SEND FAILED|SESSION CLOSED/.test(text)?'network':/TOOLS/.test(text)?'tools':/MESSAGE|JSON|FRAME/.test(text)?'protocol':'incomplete';}
  const failed=!!error||state.ok===false||!!state.partial||!!state.truncated;
  const messages={quota:'Gemini’s free allowance is temporarily exhausted. Try again after it resets.',auth:'Buddy’s Gemini access was rejected. Check the key and model access on the device.',memory:'Buddy ran short of working memory. Check that the latest firmware is installed.',
    length:'The reply exceeded Buddy’s text limit. Ask for one section or a shorter explanation.',budget:'Gemini reached its response limit. Ask a smaller question.',timeout:'Gemini did not finish the response in time.',clock:'Buddy is waiting for its internet clock. Check its Wi-Fi connection.',interrupted:'Gemini interrupted this reply.',network:'The connection to Gemini was interrupted.',tools:'Buddy could not complete a requested tool step.',protocol:'Buddy could not read part of Gemini’s response.',incomplete:'Gemini did not return a complete answer.'};
  const partial=failed&&!!partialText;
  return{failed,partial,text:partialText||'',message:failed?(partial?'Partial reply — ':'')+(messages[code]||messages.incomplete):'',code:code||(failed?'incomplete':'')};
}
globalThis.buddyReplyStatus=buddyReplyStatus;
if(typeof module!=='undefined')module.exports={buddyReplyStatus};

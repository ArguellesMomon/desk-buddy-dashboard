const assert=require('node:assert/strict'),{buddyReplyStatus:status}=require('../reply-status.js');
assert.equal(status({ok:true,reply:'A complete answer.'}).failed,false);
for(const [error,code] of [['GEMINI FREE LIMIT REACHED','quota'],['CHECK GEMINI KEY OR ACCESS','auth'],['NOT ENOUGH MEMORY FOR GEMINI','memory'],['GEMINI: NO COMPLETE REPLY','timeout'],['GEMINI DISCONNECTED','network'],['GEMINI REPLY TOO LONG','length'],['GEMINI JSON STRUCTURE ERROR','protocol']]){const result=status({ok:false,error});assert.equal(result.code,code);assert(result.message);assert.equal(result.partial,false);}
const partial=status({ok:false,partial:true,reply:'The answer starts here.',error:'GEMINI DISCONNECTED',error_code:'network'});assert.equal(partial.text,'The answer starts here.');assert.match(partial.message,/Partial reply/);
const legacy=status({ok:false,error:'GEMINI: NO COMPLETE REPLY'},'Last streamed draft.');assert.equal(legacy.text,'Last streamed draft.');assert(legacy.partial);
assert.equal(status({ok:false,partial:false,reply:'',error:'GEMINI DISCONNECTED'},'Stale pre-tool filler.').text,'');
assert.equal(status({ok:false,error:'Unknown failure',error_code:'unrecognized'}).code,'unrecognized');
assert.match(status({ok:true,truncated:true,reply:'Short excerpt',error_code:'length'}).message,/text limit/);
console.log('PASS: completed text, preserved partial/legacy drafts, distinct quota/auth/memory/network/timeout/length errors, unknown-error fallback.');

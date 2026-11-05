'use strict';
// Local study records, not an AI memory or automatic measure of mastery.
class BuddyLearningLibrary {
  constructor({storage,now=()=>Date.now()}={}){
    this.storage=storage;this.now=now;this.data={v:1,topics:[],cards:[]};this.loadError=false;this.raw=null;
    try{this.storage=storage??globalThis.localStorage;this.raw=this.storage.getItem('buddy-learning');if(this.raw)this.data=BuddyLearningLibrary.validate(JSON.parse(this.raw));}catch{this.loadError=true;}
  }
  static text(value,max){if(typeof value!=='string'||!value.trim()||new TextEncoder().encode(value.trim()).length>max)throw Error('Check the study text length.');return value.trim();}
  static validate(value){
    if(!value||value.v!==1||!Array.isArray(value.topics)||!Array.isArray(value.cards)||value.topics.length>12||value.cards.length>100)throw Error('Unsupported study file.');
    const ids=new Set(),topics=value.topics.map(t=>{
      const id=BuddyLearningLibrary.text(t.id,64);if(ids.has(id))throw Error('Duplicate topic.');ids.add(id);
      if(!['beginner','intermediate','advanced'].includes(t.level))throw Error('Invalid level.');
      return{id,title:BuddyLearningLibrary.text(t.title,80),level:t.level};
    });
    const cardIds=new Set(),cards=value.cards.map(c=>{
      const id=BuddyLearningLibrary.text(c.id,64);if(cardIds.has(id)||!ids.has(c.topic))throw Error('Invalid review card.');cardIds.add(id);
      if(!Number.isSafeInteger(c.due)||c.due<0||!Number.isInteger(c.step)||c.step<0||c.step>5||!Number.isSafeInteger(c.reviews)||c.reviews<0)throw Error('Invalid review schedule.');
      return{id,topic:c.topic,q:BuddyLearningLibrary.text(c.q,300),a:BuddyLearningLibrary.text(c.a,1800),due:c.due,step:c.step,reviews:c.reviews};
    });return{v:1,topics,cards};
  }
  id(){return Array.from(crypto.getRandomValues(new Uint8Array(12)),n=>n.toString(16).padStart(2,'0')).join('');}
  commit(data){if(this.loadError)throw Error('Saved study data could not be read. Export or clear it in settings before saving.');data=BuddyLearningLibrary.validate(data);this.storage.setItem('buddy-learning',JSON.stringify(data));this.data=data;}
  addTopic(title,level){if(this.data.topics.length>=12)throw Error('Up to 12 topics. Remove one first.');const t={id:this.id(),title:BuddyLearningLibrary.text(title,80),level};this.commit({...this.data,topics:[...this.data.topics,t]});return t.id;}
  removeTopic(id){this.commit({...this.data,topics:this.data.topics.filter(t=>t.id!==id),cards:this.data.cards.filter(c=>c.topic!==id)});}
  addCard(topic,q,a){if(this.data.cards.length>=100)throw Error('Up to 100 cards. Remove an old topic first.');const c={id:this.id(),topic,q,a,due:this.now(),step:0,reviews:0};this.commit({...this.data,cards:[...this.data.cards,c]});return c.id;}
  due(topic){return this.data.cards.filter(c=>(!topic||c.topic===topic)&&c.due<=this.now()).sort((a,b)=>a.due-b.due);}
  rate(id,rating){
    if(!['again','hard','good','easy'].includes(rating))throw Error('Choose a review rating.');
    const card=this.data.cards.find(c=>c.id===id);if(!card)throw Error('Card not found.');
    const days=[1,3,7,14,30,60],step=rating==='again'?0:rating==='hard'?card.step:Math.min(5,card.step+(rating==='easy'?2:1));
    const delay=rating==='again'?600000:rating==='hard'?86400000:days[rating==='easy'?Math.min(5,card.step+1):card.step]*86400000;
    this.commit({...this.data,cards:this.data.cards.map(c=>c.id===id?{...c,step,due:this.now()+delay,reviews:c.reviews+1}:c)});
  }
  prompt(topicId,mode){
    const topic=this.data.topics.find(t=>t.id===topicId);if(!topic)throw Error('Choose a topic first.');
    const actions={explain:'Explain one idea with a concrete example, then ask me one question. Wait for my answer.',
      example:'Give a new concrete example and a counterexample. Help me distinguish them.',
      quiz:'Ask ONE diagnostic question. Do not include its answer. Wait for me.',
      hint:'Give a small hint for the question in our recent conversation without revealing the answer.',
      teachback:'Ask me to explain one key idea in my own words; then wait and check my reasoning.',
      deeper:'Explain why the idea works, including one limitation. Ask one follow-up question.'};
    if(!actions[mode])throw Error('Choose a learning action.');
    const text=`Learning session: ${topic.title}. Level: ${topic.level}. ${actions[mode]} Use my language and correct misconceptions kindly.`;
    if(new TextEncoder().encode(text).length>400)throw Error('Shorten the topic name.');return text;
  }
  export(){if(this.loadError){if(this.raw)return this.raw;throw Error('Study storage is unavailable.');}return JSON.stringify(this.data,null,2);}
  import(text){
    if(text.length>300000)throw Error('Study file is too large.');const incoming=BuddyLearningLibrary.validate(JSON.parse(text));
    const next=JSON.parse(this.export()),map=new Map();
    for(const topic of incoming.topics){let existing=next.topics.find(t=>t.title===topic.title&&t.level===topic.level);if(!existing){existing={...topic,id:this.id()};next.topics.push(existing);}map.set(topic.id,existing.id);}
    for(const card of incoming.cards){const topic=map.get(card.topic);if(!next.cards.some(c=>c.topic===topic&&c.q===card.q&&c.a===card.a))next.cards.push({...card,id:this.id(),topic});}
    this.commit(next);
  }
  clear(){this.storage.removeItem('buddy-learning');this.data={v:1,topics:[],cards:[]};this.loadError=false;}
}
globalThis.BuddyLearningLibrary=BuddyLearningLibrary;
if(typeof module!=='undefined')module.exports={BuddyLearningLibrary};

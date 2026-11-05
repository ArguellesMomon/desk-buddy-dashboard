'use strict';
class BuddyChirps {
  constructor(){this.context=null;this.active=[];this.enabled=false;this.quiet=false;this.last=-Infinity;}
  async enable(){const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Audio)throw Error('Sound preview is unavailable in this browser.');this.context??=new Audio();await this.context.resume();this.enabled=true;}
  stop(){for(const oscillator of this.active)try{oscillator.stop();}catch{}this.active=[];}
  play(mood,force=false){
    if(!this.enabled||this.quiet||!this.context||this.context.state!=='running'||(!force&&performance.now()-this.last<3500))return;
    const voices={happy:[[660,770,75,25],[880,990,75,25],[1100,1320,150,60],[990,1320,120,100]],
      joking:[[660,770,75,25],[880,990,75,25],[1100,1320,150,60]],curious:[[480,540,110,70],[600,1080,240,100]],
      confused:[[480,540,110,70],[600,1080,240,100]],thinking:[[610,630,65,120],[720,745,65,120],[640,670,80,100]],
      gentle:[[600,540,180,70],[490,420,240,110]],sad:[[600,540,180,70],[490,420,240,110]],
      proud:[[660,660,85,30],[825,825,85,30],[990,990,85,40],[1320,1100,240,100]],
      surprised:[[380,1200,180,65],[1080,900,95,100]],sleepy:[[440,350,240,140],[350,230,360,120]]};
    const notes=voices[mood];if(!notes)return;this.stop();this.last=performance.now();let time=this.context.currentTime+.015;
    for(const [start,end,ms,gap] of notes){const oscillator=this.context.createOscillator(),gain=this.context.createGain(),duration=ms/1000;
      oscillator.type='sine';oscillator.frequency.setValueAtTime(start,time);oscillator.frequency.linearRampToValueAtTime(end,time+duration);
      gain.gain.setValueAtTime(0,time);gain.gain.linearRampToValueAtTime(.09,time+.012);gain.gain.setValueAtTime(.09,time+Math.max(.012,duration-.025));gain.gain.linearRampToValueAtTime(0,time+duration);
      oscillator.connect(gain);gain.connect(this.context.destination);oscillator.start(time);oscillator.stop(time+duration+.01);this.active.push(oscillator);
      oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();this.active=this.active.filter(item=>item!==oscillator);};time+=duration+gap/1000;
    }
  }
}
globalThis.BuddyChirps=BuddyChirps;

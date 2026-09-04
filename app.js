const STORY_SECONDS = 22;
const AD_EVERY = 3;
const AD_SECONDS = 10;
const LIVE_REFRESH_MINUTES = 15;
const PRIMARY_TIMEOUT_MS = 12000;
const FALLBACK_TIMEOUT_MS = 5000;

const GOOGLE_NEWS_RSS =
  "https://news.google.com/rss/search?" +
  new URLSearchParams({
    q:'peace OR community OR world OR "New York"',
    hl:"en-US",
    gl:"US",
    ceid:"US:en"
  }).toString();

const RSS2JSON_URL =
  "https://api.rss2json.com/v1/api.json?rss_url=" +
  encodeURIComponent(GOOGLE_NEWS_RSS);

let stories = [];
let ads = [];
let current = 0;
let playing = true;
let elapsed = 0;
let timer = null;
let fallbackStories = [];
let adRunning = false;
let liveRefreshTimer = null;
let speechBusy = false;
let usingLiveNews = false;

const el = id => document.getElementById(id);

const EMERGENCY_STORY = {
  id:"emergency-001",
  category:"Voice of Peace",
  headline:"Voice of Peace is ready",
  summary:"The broadcast is ready. Live news is being checked now. If the live service is temporarily unavailable, Voice of Peace will continue automatically and try again.",
  source_line:"Voice of Peace â¢ Connecting to live news",
  source_url:"",
  image:"",
  reflection:{
    verse_text:"Love your neighbor as yourself",
    verse_reference:"Leviticus 19:18",
    message:"Peace begins with the way we speak, listen, and respond to one another."
  }
};

function fetchWithTimeout(url, options={}, timeoutMs=10000){
  const controller = new AbortController();
  const t = setTimeout(()=>controller.abort(),timeoutMs);
  return fetch(url,{...options,signal:controller.signal}).finally(()=>clearTimeout(t));
}

function cleanText(value=""){
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]*>/g," ")
    .replace(/&nbsp;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/\s+/g," ")
    .trim();
}

function setStatus(state,text){
  const node = el("liveStatus");
  if(!node) return;
  node.className = "status-badge " + state;
  node.textContent = text;
}

function makeReflection(text){
  const t = String(text||"").toLowerCase();
  if(/war|attack|violence|killed|shoot|bomb|conflict|assault|missile|hostage|airstrike|death/.test(t)){
    return {
      verse_text:"Seek peace and pursue it",
      verse_reference:"Psalms 34:15",
      message:"Behind every headline are human lives. Voice of Peace calls for truth, restraint, protection of innocent people, and the courage to seek peace."
    };
  }
  if(/help|rescue|charity|volunteer|community|donat|kindness|aid|support|relief/.test(t)){
    return {
      verse_text:"The world is built on kindness",
      verse_reference:"Psalms 89:3",
      message:"Acts of kindness deserve attention too. When people help one another, they strengthen their communities."
    };
  }
  return {
    verse_text:"Love your neighbor as yourself",
    verse_reference:"Leviticus 19:18",
    message:"The news can inform us without teaching us to hate. We can face difficult facts while treating every person with dignity and respect."
  };
}

function rssItemToStory(item,index){
  const fullTitle = cleanText(item.title||"");
  const lastDash = fullTitle.lastIndexOf(" - ");
  const headline = lastDash > 0 ? fullTitle.slice(0,lastDash).trim() : fullTitle;
  const publisher = lastDash > 0 ? fullTitle.slice(lastDash+3).trim() : cleanText(item.author||"Google News");
  let summary = cleanText(item.description||item.content||"");
  if(!summary || summary.length < 35 || summary === fullTitle){
    summary = `Current report from ${publisher}. More details may be available as the feed updates.`;
  }
  if(summary.length > 520) summary = summary.slice(0,517).trimEnd()+"...";

  return {
    id:`rss-${index}-${item.guid||item.link||Date.now()}`,
    category:/new york/i.test(headline+" "+summary) ? "New York" : "Live News",
    headline:headline || "Latest news update",
    summary,
    source_line:`LIVE â¢ Source: ${publisher}`,
    source_url:item.link||"",
    image:item.thumbnail||item.enclosure?.link||"",
    reflection:makeReflection(headline+" "+summary)
  };
}

function normalizeRss(data){
  if(!data || data.status!=="ok" || !Array.isArray(data.items)) return [];
  return data.items.filter(x=>x&&x.title&&x.link).map(rssItemToStory).slice(0,20);
}

async function loadLiveNews(){
  const res = await fetchWithTimeout(
    RSS2JSON_URL+"&_="+Date.now(),
    {cache:"no-store",credentials:"omit",headers:{Accept:"application/json"}},
    PRIMARY_TIMEOUT_MS
  );
  if(!res.ok) throw new Error(`Live news HTTP ${res.status}`);
  const data = await res.json();
  const result = normalizeRss(data);
  if(!result.length) throw new Error("No usable live stories");
  return result;
}

async function loadFallbackData(){
  const res = await fetchWithTimeout("./data/sample-news.json?v="+Date.now(),{cache:"no-store"},FALLBACK_TIMEOUT_MS);
  if(!res.ok) throw new Error(`Fallback news HTTP ${res.status}`);
  const data = await res.json();
  fallbackStories = Array.isArray(data.stories) ? data.stories : [];
  ads = Array.isArray(data.ads) ? data.ads : [];
}

function showStory(index){
  if(!stories.length) stories=[EMERGENCY_STORY];
  current=(index+stories.length)%stories.length;
  const s=stories[current]||EMERGENCY_STORY;

  el("category").textContent=(s.category||"News").toUpperCase();
  el("headline").textContent=s.headline||"";
  el("summary").textContent=s.summary||"";
  el("sourceLine").textContent=s.source_line||"";

  if(s.reflection){
    el("verse").textContent=`"${s.reflection.verse_text||""}" â ${s.reflection.verse_reference||""}`;
    el("reflection").textContent=s.reflection.message||"";
  }

  const img=el("storyImage");
  if(img){
    if(s.image){
      img.style.display="block";
      img.onerror=()=>{img.style.display="none";};
      img.src=s.image;
    }else{
      img.style.display="none";
      img.removeAttribute("src");
    }
  }

  window.voiceOfPeaceCurrentStory={
    ...s,
    image:s.image||"many.jpeg"
  };

  elapsed=0;
  updateProgress();
}

function updateProgress(){
  const bar=el("progressBar");
  if(bar) bar.style.width=Math.min(100,(elapsed/STORY_SECONDS)*100)+"%";
}

function startTimer(){
  clearInterval(timer);
  timer=setInterval(()=>{
    if(!playing||adRunning)return;
    elapsed+=1;
    updateProgress();
    if(elapsed>=STORY_SECONDS) showStory(current+1);
  },1000);
}

async function refreshLiveNews(reset=true){
  setStatus(usingLiveNews?"live":"connecting",usingLiveNews?"LIVE":"CONNECTING");
  try{
    const live=await loadLiveNews();
    stories=live;
    usingLiveNews=true;
    if(reset) current=0;
    showStory(current);
    setStatus("live","LIVE");
  }catch(err){
    console.warn("Live news unavailable:",err);
    usingLiveNews=false;
    if(fallbackStories.length){
      stories=[...fallbackStories];
      current=0;
      showStory(0);
      setStatus("offline","BACKUP");
    }else{
      stories=[EMERGENCY_STORY];
      showStory(0);
      setStatus("offline","RETRYING");
    }
  }
}

function speechSupported(){
  return "speechSynthesis" in window && typeof SpeechSynthesisUtterance!=="undefined";
}

function stopSpeech(){
  if(!speechSupported())return;
  speechSynthesis.cancel();
  speechBusy=false;
  if(el("soundBtn")) el("soundBtn").textContent="ð Sound On";
}

function readCurrentStory(){
  if(!speechSupported()||!stories.length)return;
  if(speechBusy){stopSpeech();return;}
  const s=stories[current]||EMERGENCY_STORY;
  const r=s.reflection||{};
  const script=[
    "Good morning. This is the Voice of Peace by Emmanuel and Camili Hileah.",
    s.headline||"",
    s.summary||"",
    r.verse_text?`${r.verse_text}. ${r.verse_reference||""}.`:"",
    r.message||"",
    "Peace begins with me. Peace begins with you."
  ].filter(Boolean).join(" ");

  speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(script);
  u.rate=.94;u.pitch=1;u.volume=1;
  u.onstart=()=>{speechBusy=true;el("soundBtn").textContent="â  Stop Sound";};
  u.onend=()=>{speechBusy=false;el("soundBtn").textContent="ð Sound On";};
  u.onerror=()=>{speechBusy=false;el("soundBtn").textContent="ð Sound On";};
  speechSynthesis.speak(u);
}

function setupButtons(){
  el("prevBtn")?.addEventListener("click",()=>{stopSpeech();showStory(current-1);});
  el("nextBtn")?.addEventListener("click",()=>{stopSpeech();showStory(current+1);});
  el("playBtn")?.addEventListener("click",()=>{
    playing=!playing;
    el("playBtn").textContent=playing?"Pause":"Play";
  });
  el("soundBtn")?.addEventListener("click",readCurrentStory);
}

async function startApp(){
  setupButtons();
  stories=[EMERGENCY_STORY];
  showStory(0);
  startTimer();

  try{await loadFallbackData();}catch(err){console.warn(err);}
  await refreshLiveNews(true);

  clearInterval(liveRefreshTimer);
  liveRefreshTimer=setInterval(()=>refreshLiveNews(false),LIVE_REFRESH_MINUTES*60*1000);
}

if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded",startApp,{once:true});
}else{
  startApp();
}

const STORY_SECONDS = 22;
const AD_EVERY = 3;
const AD_SECONDS = 10;

const LIVE_NEWS_URL =
  'https://api.gdeltproject.org/api/v2/context/context' +
  '?query=(peace%20OR%20community%20OR%20world%20OR%20New%20York)' +
  '&mode=artlist&maxrecords=25&format=json&timespan=24h';

let stories = [];
let ads = [];
let current = 0;
let playing = true;
let elapsed = 0;
let timer = null;
let fallbackStories = [];

const el = id => document.getElementById(id);

async function loadFallbackData() {
  const res = await fetch('data/sample-news.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Fallback news HTTP ${res.status}`);
  const data = await res.json();

  fallbackStories = data.stories || [];
  ads = data.ads || [];

  return data;
}

function cleanText(value = '') {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeReflection(article) {
  const text = `${article.title || ''} ${article.sentence || ''}`.toLowerCase();

  if (/(war|attack|violence|killed|shoot|bomb|conflict|assault)/.test(text)) {
    return {
      verse_text: 'Seek peace and pursue it',
      verse_reference: 'Psalms 34:15',
      message:
        'Behind every headline are human lives. Voice of Peace calls for truth, restraint, protection of innocent people, and the courage to seek a path away from hatred and toward peace.'
    };
  }

  if (/(help|rescue|charity|volunteer|community|donat|kindness)/.test(text)) {
    return {
      verse_text: 'The world is built on kindness',
      verse_reference: 'Psalms 89:3',
      message:
        'Acts of kindness deserve attention too. When people help one another without seeking reward, they strengthen their communities and remind us that goodness can be contagious.'
    };
  }

  return {
    verse_text: 'Love your neighbor as yourself',
    verse_reference: 'Leviticus 19:18',
    message:
      'The news can inform us without teaching us to hate. We can face difficult facts while still treating every person with dignity, compassion, and respect.'
  };
}

function articleToStory(article, index) {
  const title = cleanText(article.title) || 'Latest world news update';
  const sentence = cleanText(article.sentence);

  return {
    id: `live-${index}-${article.seendate || Date.now()}`,
    category: article.sourcecountry || 'Live News',
    headline: title,
    summary:
      sentence ||
      'A live story has been detected by the Voice of Peace news feed. Open the original source for the complete report.',
    source_line: `LIVE • Source: ${article.domain || 'news source'}${
      article.seendate ? ` • ${article.seendate}` : ''
    }`,
    source_url: article.url || '',
    reflection: makeReflection(article),
    ticker: 'LIVE NEWS • Truth before rumors • Peace • Love • Compassion • Respect'
  };
}

async function loadLiveNews() {
  const res = await fetch(LIVE_NEWS_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Live news HTTP ${res.status}`);

  const data = await res.json();
  const articles = Array.isArray(data.articles) ? data.articles : [];

  return articles
    .filter(a => a && a.title && a.url)
    .map(articleToStory)
    .slice(0, 20);
}

async function loadData() {
  try {
    await loadFallbackData();
  } catch (err) {
    console.warn('Could not load fallback file:', err);
    fallbackStories = [];
    ads = [];
  }

  try {
    const liveStories = await loadLiveNews();

    if (liveStories.length) {
      stories = liveStories;
      console.log(`Voice of Peace loaded ${stories.length} live stories.`);
    } else {
      throw new Error('Live feed returned no usable stories.');
    }
  } catch (err) {
    console.warn('Live feed unavailable. Using demo fallback.', err);
    stories = fallbackStories;
  }

  if (!stories.length) {
    throw new Error('No live or fallback stories are available.');
  }

  showStory(0);
  startTimer();

  // Refresh the live feed every 15 minutes without interrupting the current story.
  setInterval(refreshLiveNews, 15 * 60 * 1000);
}

async function refreshLiveNews() {
  try {
    const refreshed = await loadLiveNews();
    if (refreshed.length) {
      stories = refreshed;
      if (current >= stories.length) current = 0;
      console.log(`Voice of Peace refreshed ${stories.length} live stories.`);
    }
  } catch (err) {
    console.warn('Live news refresh failed; keeping current stories.', err);
  }
}

function showStory(index) {
  if (!stories.length) return;

  current = (index + stories.length) % stories.length;
  const s = stories[current];

  el('category').textContent = (s.category || 'News').toUpperCase();
  el('headline').textContent = s.headline || '';
  el('summary').textContent = s.summary || '';
  el('sourceLine').textContent = s.source_line || '';

  if (s.reflection) {
    el('verse').textContent =
      `"${s.reflection.verse_text || ''}" — ${s.reflection.verse_reference || ''}`;
    el('reflection').textContent = s.reflection.message || '';
  }

  el('ticker').textContent =
    s.ticker ||
    'Peace • Love • Truth • Compassion • Respect • Help one another';

  // Make the source line clickable when a live article URL is available.
  const sourceLine = el('sourceLine');
  if (s.source_url) {
    sourceLine.style.cursor = 'pointer';
    sourceLine.title = 'Open original news source';
    sourceLine.onclick = () =>
      window.open(s.source_url, '_blank', 'noopener,noreferrer');
  } else {
    sourceLine.style.cursor = '';
    sourceLine.title = '';
    sourceLine.onclick = null;
  }

  elapsed = 0;
  updateProgress();
}

function startTimer() {
  clearInterval(timer);

  timer = setInterval(() => {
    if (!playing) return;

    elapsed += 1;
    updateProgress();

    if (elapsed >= STORY_SECONDS) {
      const completedStoryNumber = current + 1;

      if (completedStoryNumber % AD_EVERY === 0) {
        runAd(() => showStory(current + 1));
      } else {
        showStory(current + 1);
      }
    }
  }, 1000);
}

function updateProgress() {
  const pct = Math.min(100, (elapsed / STORY_SECONDS) * 100);
  el('progressBar').style.width = pct + '%';
}

function runAd(done) {
  playing = false;

  const ad = ads.length
    ? ads[Math.floor(Math.random() * ads.length)]
    : {
        title: 'Advertise on Voice of Peace',
        text: 'Sponsored messages can appear between Voice of Peace stories.'
      };

  el('adTitle').textContent = ad.title;
  el('adText').textContent = ad.text;
  el('adOverlay').classList.remove('hidden');

  let remaining = AD_SECONDS;
  el('adCountdown').textContent = remaining;

  const adTimer = setInterval(() => {
    remaining -= 1;
    el('adCountdown').textContent = Math.max(0, remaining);

    if (remaining <= 0) {
      clearInterval(adTimer);
      el('adOverlay').classList.add('hidden');
      playing = true;
      done();
    }
  }, 1000);
}

function readCurrentStory() {
  if (!('speechSynthesis' in window) || !stories.length) {
    alert('Speech playback is not supported in this browser.');
    return;
  }

  speechSynthesis.cancel();

  const s = stories[current];
  const reflection = s.reflection || {};

  const script = [
    'Good morning. This is the Voice of Peace by Emmanuel Hileah.',
    s.headline,
    s.summary,
    'Source.',
    s.source_line,
    'Now, here is the Voice of Peace reflection.',
    `${reflection.verse_text || ''}. ${reflection.verse_reference || ''}.`,
    reflection.message || '',
    'This is the Voice of Peace by Emmanuel Hileah. Peace begins with me. Peace begins with you.'
  ].join(' ');

  const utter = new SpeechSynthesisUtterance(script);
  utter.rate = 0.94;
  utter.pitch = 1.0;
  speechSynthesis.speak(utter);
}

el('prevBtn').addEventListener('click', () => showStory(current - 1));
el('nextBtn').addEventListener('click', () => showStory(current + 1));

el('playBtn').addEventListener('click', () => {
  playing = !playing;
  el('playBtn').textContent = playing ? 'Pause' : 'Play';

  if (!playing && 'speechSynthesis' in window) {
    speechSynthesis.pause();
  } else if (playing && 'speechSynthesis' in window) {
    speechSynthesis.resume();
  }
});

el('soundBtn').addEventListener('click', readCurrentStory);

loadData().catch(err => {
  console.error(err);
  el('headline').textContent = 'Unable to load the broadcast';
  el('summary').textContent =
    'Check that app.js and data/sample-news.json were uploaded to the same GitHub repository.';
});

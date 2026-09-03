const STORY_SECONDS = 22;
const AD_EVERY = 3;
const AD_SECONDS = 10;
const LIVE_REFRESH_MINUTES = 15;
const LIVE_TIMEOUT_MS = 10000;
const FALLBACK_TIMEOUT_MS = 5000;

const LIVE_NEWS_URL =
  'https://api.gdeltproject.org/api/v2/doc/doc' +
  '?query=(peace%20OR%20community%20OR%20world%20OR%20%22New%20York%22)' +
  '&mode=artlist' +
  '&maxrecords=25' +
  '&format=json' +
  '&timespan=24h' +
  '&sort=datedesc';

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

const el = id => document.getElementById(id);

const EMERGENCY_STORY = {
  id: 'emergency-001',
  category: 'Voice of Peace',
  headline: 'Voice of Peace is ready',
  summary:
    'The broadcast is ready. Live news is being checked now. If the live service is temporarily unavailable, Voice of Peace will continue automatically and try again.',
  source_line: 'Voice of Peace • Connecting to live news',
  source_url: '',
  reflection: {
    verse_text: 'Love your neighbor as yourself',
    verse_reference: 'Leviticus 19:18',
    message:
      'Peace begins with the way we speak, listen, and respond to one another. Kindness, truth, compassion, and respect remain important in every headline.'
  },
  ticker:
    'Peace • Love • Truth • Compassion • Respect • Help one another'
};

function fetchWithTimeout(url, options = {}, timeoutMs = LIVE_TIMEOUT_MS) {
  if (typeof AbortController === 'undefined') {
    return fetch(url, options);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, {
    ...options,
    signal: controller.signal
  }).finally(() => clearTimeout(timeoutId));
}

async function loadFallbackData() {
  const url = './data/sample-news.json?v=' + Date.now();

  const res = await fetchWithTimeout(
    url,
    { cache: 'no-store' },
    FALLBACK_TIMEOUT_MS
  );

  if (!res.ok) {
    throw new Error(`Fallback news HTTP ${res.status}`);
  }

  const data = await res.json();

  fallbackStories = Array.isArray(data.stories) ? data.stories : [];
  ads = Array.isArray(data.ads) ? data.ads : [];

  return data;
}

function cleanText(value = '') {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function makeReflection(article) {
  const text = [
    article.title || '',
    article.sentence || '',
    article.description || '',
    article.excerpt || ''
  ]
    .join(' ')
    .toLowerCase();

  if (
    /(war|attack|violence|killed|shoot|bomb|conflict|assault|missile|hostage)/.test(
      text
    )
  ) {
    return {
      verse_text: 'Seek peace and pursue it',
      verse_reference: 'Psalms 34:15',
      message:
        'Behind every headline are human lives. Voice of Peace calls for truth, restraint, protection of innocent people, and the courage to seek a path away from hatred and toward peace.'
    };
  }

  if (
    /(help|rescue|charity|volunteer|community|donat|kindness|aid|support)/.test(
      text
    )
  ) {
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

  const sentence = cleanText(
    article.sentence ||
      article.description ||
      article.excerpt ||
      article.socialimage ||
      ''
  );

  const domain = cleanText(article.domain || '');
  const sourceCountry = cleanText(article.sourcecountry || '');
  const seenDate = cleanText(article.seendate || '');

  return {
    id: `live-${index}-${seenDate || Date.now()}`,
    category: sourceCountry || 'Live News',
    headline: title,
    summary:
      sentence ||
      `Latest report from ${domain || 'a news source'}. Tap the source below to read the complete report.`,
    source_line:
      `LIVE • Source: ${domain || 'news source'}` +
      (seenDate ? ` • ${seenDate}` : ''),
    source_url: article.url || '',
    reflection: makeReflection(article),
    ticker:
      'LIVE NEWS • Truth before rumors • Peace • Love • Compassion • Respect'
  };
}

async function loadLiveNews() {
  const separator = LIVE_NEWS_URL.includes('?') ? '&' : '?';
  const url = LIVE_NEWS_URL + separator + '_=' + Date.now();

  const res = await fetchWithTimeout(
    url,
    {
      cache: 'no-store',
      headers: {
        Accept: 'application/json,text/plain,*/*'
      }
    },
    LIVE_TIMEOUT_MS
  );

  if (!res.ok) {
    throw new Error(`Live news HTTP ${res.status}`);
  }

  const raw = await res.text();

  if (!raw.trim()) {
    throw new Error('Live feed returned an empty response.');
  }

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('Live feed did not return valid JSON.');
  }

  const articles = Array.isArray(data.articles) ? data.articles : [];

  return articles
    .filter(article => article && article.title && article.url)
    .map(articleToStory)
    .slice(0, 20);
}

function beginBroadcast(initialStories) {
  stories =
    Array.isArray(initialStories) && initialStories.length
      ? initialStories
      : [EMERGENCY_STORY];

  current = 0;
  showStory(0);
  startTimer();
}

function setStoriesWithoutRestart(newStories, resetToFirst = false) {
  if (!Array.isArray(newStories) || !newStories.length) {
    return;
  }

  stories = newStories;

  if (resetToFirst || current >= stories.length) {
    current = 0;
  }

  showStory(current);
}

async function loadData() {
  beginBroadcast([EMERGENCY_STORY]);

  try {
    await loadFallbackData();

    if (fallbackStories.length) {
      setStoriesWithoutRestart(fallbackStories, true);
    }
  } catch (err) {
    console.warn('Fallback news unavailable:', err);
  }

  refreshLiveNews(true);

  clearInterval(liveRefreshTimer);

  liveRefreshTimer = setInterval(
    () => refreshLiveNews(false),
    LIVE_REFRESH_MINUTES * 60 * 1000
  );
}

async function refreshLiveNews(resetToFirstStory = false) {
  try {
    const refreshed = await loadLiveNews();

    if (!refreshed.length) {
      throw new Error('Live feed returned no usable stories.');
    }

    setStoriesWithoutRestart(refreshed, resetToFirstStory);

    console.log(
      `Voice of Peace loaded ${stories.length} live stories successfully.`
    );
  } catch (err) {
    console.warn(
      'Live news unavailable; Voice of Peace will continue with backup stories.',
      err
    );
  }
}

function showStory(index) {
  if (!stories.length) {
    stories = [EMERGENCY_STORY];
  }

  current = (index + stories.length) % stories.length;

  const s = stories[current] || EMERGENCY_STORY;

  const category = el('category');
  const headline = el('headline');
  const summary = el('summary');
  const sourceLine = el('sourceLine');
  const verse = el('verse');
  const reflection = el('reflection');
  const ticker = el('ticker');

  if (category) {
    category.textContent = (s.category || 'News').toUpperCase();
  }

  if (headline) {
    headline.textContent = s.headline || '';
  }

  if (summary) {
    summary.textContent = s.summary || '';
  }

  if (sourceLine) {
    sourceLine.textContent = s.source_line || '';

    if (s.source_url) {
      sourceLine.style.cursor = 'pointer';
      sourceLine.title = 'Open original news source';
      sourceLine.setAttribute('role', 'link');
      sourceLine.tabIndex = 0;

      sourceLine.onclick = () => {
        window.open(s.source_url, '_blank', 'noopener,noreferrer');
      };

      sourceLine.onkeydown = event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          window.open(s.source_url, '_blank', 'noopener,noreferrer');
        }
      };
    } else {
      sourceLine.style.cursor = '';
      sourceLine.title = '';
      sourceLine.removeAttribute('role');
      sourceLine.removeAttribute('tabindex');
      sourceLine.onclick = null;
      sourceLine.onkeydown = null;
    }
  }

  if (s.reflection) {
    if (verse) {
      verse.textContent =
        `"${s.reflection.verse_text || ''}" — ` +
        `${s.reflection.verse_reference || ''}`;
    }

    if (reflection) {
      reflection.textContent = s.reflection.message || '';
    }
  } else {
    if (verse) verse.textContent = '';
    if (reflection) reflection.textContent = '';
  }

  if (ticker) {
    ticker.textContent =
      s.ticker ||
      'Peace • Love • Truth • Compassion • Respect • Help one another';
  }

  elapsed = 0;
  updateProgress();
}

function startTimer() {
  clearInterval(timer);

  timer = setInterval(() => {
    if (!playing || adRunning) {
      return;
    }

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
  const progressBar = el('progressBar');

  if (!progressBar) {
    return;
  }

  const pct = Math.min(100, (elapsed / STORY_SECONDS) * 100);
  progressBar.style.width = pct + '%';
}

function runAd(done) {
  if (adRunning) {
    return;
  }

  const adOverlay = el('adOverlay');
  const adTitle = el('adTitle');
  const adText = el('adText');
  const adCountdown = el('adCountdown');

  if (!adOverlay || !adTitle || !adText || !adCountdown) {
    done();
    return;
  }

  adRunning = true;

  const wasPlaying = playing;

  const ad = ads.length
    ? ads[Math.floor(Math.random() * ads.length)]
    : {
        title: 'Advertise on Voice of Peace',
        text:
          'Sponsored messages can appear between Voice of Peace stories.'
      };

  adTitle.textContent = ad.title || 'Voice of Peace';
  adText.textContent = ad.text || '';
  adOverlay.classList.remove('hidden');

  let remaining = AD_SECONDS;
  adCountdown.textContent = remaining;

  const adTimer = setInterval(() => {
    remaining -= 1;
    adCountdown.textContent = Math.max(0, remaining);

    if (remaining <= 0) {
      clearInterval(adTimer);

      adOverlay.classList.add('hidden');
      adRunning = false;
      playing = wasPlaying;

      const playBtn = el('playBtn');

      if (playBtn) {
        playBtn.textContent = playing ? 'Pause' : 'Play';
      }

      done();
    }
  }, 1000);
}

function speechSupported() {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance !== 'undefined'
  );
}

function setSoundButtonMessage(message, restoreAfterMs = 2200) {
  const soundBtn = el('soundBtn');

  if (!soundBtn) {
    return;
  }

  const original =
    soundBtn.dataset.originalLabel || soundBtn.textContent || 'Read Aloud';

  soundBtn.dataset.originalLabel = original;
  soundBtn.textContent = message;

  if (restoreAfterMs > 0) {
    setTimeout(() => {
      if (!speechBusy) {
        soundBtn.textContent = original;
      }
    }, restoreAfterMs);
  }
}

function chooseEnglishVoice() {
  if (!speechSupported()) {
    return null;
  }

  const voices = window.speechSynthesis.getVoices();

  if (!voices || !voices.length) {
    return null;
  }

  return (
    voices.find(
      voice =>
        /^en-US/i.test(voice.lang) &&
        /Samantha|Ava|Alex|Google US English|Microsoft/i.test(voice.name)
    ) ||
    voices.find(voice => /^en-US/i.test(voice.lang)) ||
    voices.find(voice => /^en/i.test(voice.lang)) ||
    voices[0]
  );
}

function stopSpeech() {
  if (!speechSupported()) {
    return;
  }

  try {
    window.speechSynthesis.cancel();
  } catch {}

  speechBusy = false;

  const soundBtn = el('soundBtn');

  if (soundBtn) {
    soundBtn.textContent =
      soundBtn.dataset.originalLabel || 'Read Aloud';
  }
}

function readCurrentStory() {
  if (!stories.length) {
    return;
  }

  if (!speechSupported()) {
    setSoundButtonMessage('Audio unavailable');
    return;
  }

  const s = stories[current] || EMERGENCY_STORY;
  const r = s.reflection || {};

  const script = [
    'Good morning. This is the Voice of Peace by Emmanuel Hileah.',
    s.headline || '',
    s.summary || '',
    s.source_line ? `Source. ${s.source_line}` : '',
    'Now, here is the Voice of Peace reflection.',
    r.verse_text
      ? `${r.verse_text}. ${r.verse_reference || ''}.`
      : '',
    r.message || '',
    'This is the Voice of Peace by Emmanuel Hileah. Peace begins with me. Peace begins with you.'
  ]
    .filter(Boolean)
    .join(' ');

  try {
    window.speechSynthesis.cancel();

    const utter = new SpeechSynthesisUtterance(script);
    const voice = chooseEnglishVoice();

    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang || 'en-US';
    } else {
      utter.lang = 'en-US';
    }

    utter.rate = 0.94;
    utter.pitch = 1.0;
    utter.volume = 1.0;

    utter.onstart = () => {
      speechBusy = true;
      setSoundButtonMessage('Speaking…', 0);
    };

    utter.onend = () => {
      speechBusy = false;

      const soundBtn = el('soundBtn');

      if (soundBtn) {
        soundBtn.textContent =
          soundBtn.dataset.originalLabel || 'Read Aloud';
      }
    };

    utter.onerror = event => {
      console.warn('Speech playback failed:', event);
      speechBusy = false;
      setSoundButtonMessage('Audio unavailable');
    };

    try {
      window.speechSynthesis.resume();
    } catch {}

    window.speechSynthesis.speak(utter);
  } catch (err) {
    console.warn('Speech playback unavailable:', err);
    speechBusy = false;
    setSoundButtonMessage('Audio unavailable');
  }
}

function setupButtons() {
  const prevBtn = el('prevBtn');
  const nextBtn = el('nextBtn');
  const playBtn = el('playBtn');
  const soundBtn = el('soundBtn');

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      stopSpeech();
      showStory(current - 1);
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      stopSpeech();
      showStory(current + 1);
    });
  }

  if (playBtn) {
    playBtn.addEventListener('click', () => {
      playing = !playing;
      playBtn.textContent = playing ? 'Pause' : 'Play';

      if (speechSupported()) {
        try {
          if (!playing) {
            window.speechSynthesis.pause();
          } else {
            window.speechSynthesis.resume();
          }
        } catch {}
      }
    });
  }

  if (soundBtn) {
    soundBtn.dataset.originalLabel =
      soundBtn.textContent || 'Read Aloud';

    soundBtn.addEventListener('click', () => {
      if (speechBusy && speechSupported()) {
        stopSpeech();
        return;
      }

      readCurrentStory();
    });
  }
}

function prepareSpeechVoices() {
  if (!speechSupported()) {
    return;
  }

  try {
    window.speechSynthesis.getVoices();

    if ('onvoiceschanged' in window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
      };
    }
  } catch {}
}

function startApp() {
  setupButtons();
  prepareSpeechVoices();
  loadData();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp, { once: true });
} else {
  startApp();
}

const STORY_SECONDS = 22;
const AD_EVERY = 3;
const AD_SECONDS = 10;
const LIVE_REFRESH_MINUTES = 15;
const LIVE_RETRY_SECONDS = 45;
const LIVE_TIMEOUT_MS = 10000;
const JSONP_TIMEOUT_MS = 12000;
const FALLBACK_TIMEOUT_MS = 5000;

const LIVE_NEWS_BASE_URL =
  'https://api.gdeltproject.org/api/v2/doc/doc';

const LIVE_QUERIES = [
  'peace OR diplomacy OR community',
  '"New York" OR community',
  'world OR international'
];

let stories = [];
let ads = [];
let fallbackStories = [];
let current = 0;
let playing = true;
let elapsed = 0;
let timer = null;
let adRunning = false;
let liveRefreshTimer = null;
let retryTimer = null;
let speechBusy = false;
let usingLiveNews = false;
let storyCounter = 0;

const el = id => document.getElementById(id);

const EMERGENCY_STORY = {
  id: 'emergency-001',
  category: 'Voice of Peace',
  headline: 'Voice of Peace is ready',
  summary:
    'The broadcast is ready. Live news is being checked now. If the live service is temporarily unavailable, Voice of Peace will continue automatically and try again.',
  source_line: 'Voice of Peace',
  reflection: {
    verse_text: 'Love your neighbor as yourself.',
    verse_reference: 'Leviticus 19:18',
    message:
      'Peace begins with the way we speak, listen, and treat one another.'
  }
};

function setText(id, value) {
  const node = el(id);
  if (node) node.textContent = value || '';
}

function setLiveStatus(state, detail = '') {
  const badge =
    el('liveStatus') ||
    el('statusBadge') ||
    el('connectionStatus');

  const reporting =
    el('sourceLine') ||
    el('reportingText') ||
    el('reporting');

  const normalized = String(state || '').toLowerCase();

  if (badge) {
    badge.classList.remove('live', 'connecting', 'offline');

    if (normalized === 'live') {
      badge.textContent = 'LIVE';
      badge.classList.add('live');
    } else if (normalized === 'connecting') {
      badge.textContent = 'CONNECTING';
      badge.classList.add('connecting');
    } else {
      badge.textContent = 'RETRYING';
      badge.classList.add('offline');
    }
  }

  if (reporting && detail) {
    reporting.textContent = detail;
  }
}

function withTimeout(promise, ms, label = 'Request') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    )
  ]);
}

function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

function cleanText(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function normalizeLiveArticle(article, index) {
  const headline = cleanText(article?.title);

  if (!headline) return null;

  const source = cleanText(
    article?.domain ||
    article?.sourcecountry ||
    'Live source'
  );

  const country = cleanText(article?.sourcecountry || '');
  const language = cleanText(article?.language || '');
  const seen = cleanText(article?.seendate || '');

  const url = safeUrl(article?.url || '');

  let category = country
    ? titleCase(country)
    : 'World News';

  if (/new york/i.test(headline)) {
    category = 'New York';
  }

  const bits = [];

  if (source) {
    bits.push(`Latest report from ${source}.`);
  }

  if (country) {
    bits.push(`Reported from ${country}.`);
  }

  if (
    language &&
    !/^english$/i.test(language)
  ) {
    bits.push(`Source language: ${language}.`);
  }

  return {
    id: `live-${Date.now()}-${index}`,

    category,

    headline,

    summary:
      bits.join(' ') ||
      'A new live-news report has been received by Voice of Peace.',

    source_line:
      `LIVE • ${source}${seen ? ` • ${seen}` : ''}`,

    url,

    image: safeUrl(article?.socialimage || ''),

    reflection: {
      verse_text:
        'Seek peace and pursue it.',

      verse_reference:
        'Psalm 34:14',

      message:
        'Even when the news is difficult, we can answer the world with truth, compassion, responsibility, and a commitment to peace.'
    }
  };
}

function extractArticles(payload) {
  const raw =
    Array.isArray(payload?.articles)
      ? payload.articles
      : [];

  const seen = new Set();

  return raw
    .map(normalizeLiveArticle)
    .filter(Boolean)
    .filter(story => {

      const key =
        story.url ||
        story.headline.toLowerCase();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);

      return true;
    });
}

function buildLiveUrl(
  query,
  format = 'json',
  callbackName = ''
) {

  const params =
    new URLSearchParams({
      query,
      mode: 'artlist',
      maxrecords: '25',
      format,
      timespan: '24h',
      sort: 'datedesc'
    });

  if (callbackName) {
    params.set(
      'callback',
      callbackName
    );
  }

  return (
    `${LIVE_NEWS_BASE_URL}?` +
    params.toString()
  );
}

async function fetchLiveJSON(query) {

  const url =
    buildLiveUrl(
      query,
      'json'
    );

  const response =
    await withTimeout(

      fetch(url, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',

        headers: {
          Accept: 'application/json'
        }
      }),

      LIVE_TIMEOUT_MS,

      'Live news'
    );

  if (!response.ok) {

    throw new Error(
      `Live news HTTP ${response.status}`
    );
  }

  const payload =
    await response.json();

  const result =
    extractArticles(payload);

  if (!result.length) {

    throw new Error(
      'Live news returned no articles'
    );
  }

  return result;
}

function fetchLiveJSONP(query) {

  return new Promise(
    (resolve, reject) => {

      const callbackName =
        `voiceOfPeaceGdelt_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2)}`;

      const script =
        document.createElement(
          'script'
        );

      let settled = false;

      const cleanup = () => {

        if (script.parentNode) {
          script.parentNode.removeChild(
            script
          );
        }

        try {

          delete window[
            callbackName
          ];

        } catch {

          window[
            callbackName
          ] = undefined;
        }
      };

      const timeout =
        setTimeout(() => {

          if (settled) return;

          settled = true;

          cleanup();

          reject(
            new Error(
              'JSONP live news timed out'
            )
          );

        }, JSONP_TIMEOUT_MS);

      window[
        callbackName
      ] = payload => {

        if (settled) return;

        settled = true;

        clearTimeout(timeout);

        cleanup();

        const result =
          extractArticles(payload);

        if (!result.length) {

          reject(
            new Error(
              'JSONP live news returned no articles'
            )
          );

          return;
        }

        resolve(result);
      };

      script.onerror = () => {

        if (settled) return;

        settled = true;

        clearTimeout(timeout);

        cleanup();

        reject(
          new Error(
            'JSONP live news failed'
          )
        );
      };

      script.async = true;

      script.src =
        buildLiveUrl(
          query,
          'jsonp',
          callbackName
        );

      document.head.appendChild(
        script
      );
    }
  );
}

async function loadLiveNews() {

  setLiveStatus(
    'connecting',
    'Voice of Peace • Connecting to live news'
  );

  let lastError = null;

  for (
    const query of LIVE_QUERIES
  ) {

    /*
      FIRST METHOD:
      JSONP.

      This is useful for
      GitHub Pages and Safari.
    */

    try {

      const liveStories =
        await fetchLiveJSONP(
          query
        );

      if (liveStories.length) {

        stories =
          liveStories;

        usingLiveNews = true;

        current =
          Math.min(
            current,
            Math.max(
              0,
              stories.length - 1
            )
          );

        setLiveStatus(
          'live',
          `Voice of Peace • LIVE • ${stories.length} current reports`
        );

        renderStory();

        scheduleLiveRefresh();

        clearRetryTimer();

        return true;
      }

    } catch (err) {

      lastError = err;

      console.warn(
        'GDELT JSONP attempt failed:',
        query,
        err
      );
    }

    /*
      SECOND METHOD:
      normal JSON fetch.
    */

    try {

      const liveStories =
        await fetchLiveJSON(
          query
        );

      if (liveStories.length) {

        stories =
          liveStories;

        usingLiveNews = true;

        current =
          Math.min(
            current,
            Math.max(
              0,
              stories.length - 1
            )
          );

        setLiveStatus(
          'live',
          `Voice of Peace • LIVE • ${stories.length} current reports`
        );

        renderStory();

        scheduleLiveRefresh();

        clearRetryTimer();

        return true;
      }

    } catch (err) {

      lastError = err;

      console.warn(
        'GDELT fetch attempt failed:',
        query,
        err
      );
    }
  }

  console.error(
    'All live-news attempts failed:',
    lastError
  );

  usingLiveNews = false;

  if (fallbackStories.length) {

    stories =
      [...fallbackStories];

    current =
      Math.min(
        current,
        Math.max(
          0,
          stories.length - 1
        )
      );

    setLiveStatus(
      'retrying',
      'Voice of Peace • Broadcast active • Retrying live news automatically'
    );

    renderStory();

  } else {

    stories =
      [EMERGENCY_STORY];

    current = 0;

    setLiveStatus(
      'retrying',
      'Voice of Peace • Broadcast active • Retrying live news automatically'
    );

    renderStory();
  }

  scheduleRetry();

  return false;
}

async function loadFallbackData() {

  try {

    const response =
      await withTimeout(

        fetch(
          `data/sample-news.json?v=${Date.now()}`,
          {
            cache: 'no-store'
          }
        ),

        FALLBACK_TIMEOUT_MS,

        'Fallback news'
      );

    if (!response.ok) {

      throw new Error(
        `Fallback news HTTP ${response.status}`
      );
    }

    const data =
      await response.json();

    fallbackStories =
      Array.isArray(
        data?.stories
      )
        ? data.stories
        : [];

    ads =
      Array.isArray(
        data?.ads
      )
        ? data.ads
        : [];

    if (
      !stories.length &&
      fallbackStories.length
    ) {

      stories =
        [...fallbackStories];
    }

  } catch (err) {

    console.warn(
      'Fallback data failed:',
      err
    );

    fallbackStories =
      [EMERGENCY_STORY];

    if (!stories.length) {

      stories =
        [EMERGENCY_STORY];
    }
  }
}

function scheduleLiveRefresh() {

  if (liveRefreshTimer) {

    clearInterval(
      liveRefreshTimer
    );
  }

  liveRefreshTimer =
    setInterval(
      () => loadLiveNews(),

      LIVE_REFRESH_MINUTES *
        60 *
        1000
    );
}

function clearRetryTimer() {

  if (retryTimer) {

    clearTimeout(
      retryTimer
    );

    retryTimer = null;
  }
}

function scheduleRetry() {

  clearRetryTimer();

  retryTimer =
    setTimeout(
      () => loadLiveNews(),

      LIVE_RETRY_SECONDS *
        1000
    );
}

function currentStory() {

  return (
    stories[current] ||
    EMERGENCY_STORY
  );
}

function renderStory() {

  const story =
    currentStory();

  setText(
    'category',
    story.category ||
      'Voice of Peace'
  );

  setText(
    'headline',
    story.headline || ''
  );

  setText(
    'summary',
    story.summary || ''
  );

  setText(
    'sourceLine',
    story.source_line || ''
  );

  const reflection =
    story.reflection || {};

  const verseText =
    reflection.verse_text ||
    'Seek peace and pursue it.';

  const verseRef =
    reflection.verse_reference ||
    'Psalm 34:14';

  setText(
    'verse',
    `“${verseText}” — ${verseRef}`
  );

  setText(
    'reflection',

    reflection.message ||

      'May knowledge lead us toward compassion, responsibility, and peace.'
  );

  const image =
    el('storyImage') ||
    el('newsImage');

  if (
    image &&
    story.image
  ) {

    image.src =
      story.image;

    image.style.display =
      '';

    image.onerror =
      () => {

        image.style.display =
          'none';
      };
  }

  const link =
    el('storyLink') ||
    el('readMore');

  if (link) {

    if (story.url) {

      link.href =
        story.url;

      link.style.display =
        '';

    } else {

      link.removeAttribute(
        'href'
      );

      link.style.display =
        'none';
    }
  }

  elapsed = 0;

  updateProgress();

  if (
    !adRunning &&
    playing
  ) {

    speakStory(story);
  }
}

function nextStory(
  manual = false
) {

  if (
    !stories.length ||
    adRunning
  ) {
    return;
  }

  if (!manual) {

    storyCounter += 1;

    if (
      ads.length &&
      AD_EVERY > 0 &&
      storyCounter %
        AD_EVERY ===
        0
    ) {

      runAd();

      return;
    }
  }

  current =
    (current + 1) %
    stories.length;

  renderStory();
}

function previousStory() {

  if (
    !stories.length ||
    adRunning
  ) {
    return;
  }

  current =
    (
      current -
      1 +
      stories.length
    ) %
    stories.length;

  renderStory();
}

function updateProgress() {

  const bar =
    el('progressBar');

  if (!bar) return;

  const percentage =
    Math.max(
      0,

      Math.min(
        100,

        (
          elapsed /
          STORY_SECONDS
        ) * 100
      )
    );

  bar.style.width =
    `${percentage}%`;
}

function startTimer() {

  if (timer) {

    clearInterval(timer);
  }

  timer =
    setInterval(() => {

      if (
        !playing ||
        adRunning
      ) {
        return;
      }

      elapsed += 0.25;

      updateProgress();

      if (
        elapsed >=
        STORY_SECONDS
      ) {

        elapsed = 0;

        nextStory(false);
      }

    }, 250);
}

function togglePlay() {

  playing =
    !playing;

  const button =
    el('playBtn');

  if (button) {

    button.textContent =
      playing
        ? 'Pause'
        : 'Play';

    button.setAttribute(
      'aria-label',

      playing
        ? 'Pause'
        : 'Play'
    );
  }

  if (
    !playing &&
    'speechSynthesis' in window
  ) {

    window.speechSynthesis.cancel();

    speechBusy = false;

  } else if (playing) {

    speakStory(
      currentStory()
    );
  }
}

function getSpeechEnabled() {

  const button =
    el('soundBtn');

  if (!button) {
    return true;
  }

  return (
    button.dataset.sound !==
    'off'
  );
}

function toggleSound() {

  const button =
    el('soundBtn');

  if (!button) return;

  const isOff =
    button.dataset.sound ===
    'off';

  button.dataset.sound =
    isOff
      ? 'on'
      : 'off';

  button.textContent =
    isOff
      ? 'Sound On'
      : 'Sound Off';

  if (
    !isOff &&
    'speechSynthesis' in window
  ) {

    window.speechSynthesis.cancel();

    speechBusy = false;

  } else {

    speakStory(
      currentStory()
    );
  }
}

function speakStory(story) {

  if (
    !playing ||
    adRunning ||
    speechBusy ||
    !getSpeechEnabled() ||
    !(
      'speechSynthesis'
      in window
    )
  ) {

    return;
  }

  const text = [

    story?.category,

    story?.headline,

    story?.summary,

    story?.reflection
      ?.message

  ]
    .filter(Boolean)
    .join('. ');

  if (!text) return;

  window.speechSynthesis.cancel();

  const utterance =
    new SpeechSynthesisUtterance(
      text
    );

  utterance.rate = 0.92;

  utterance.pitch = 1;

  utterance.volume = 1;

  utterance.onstart =
    () => {

      speechBusy = true;
    };

  utterance.onend =
    () => {

      speechBusy = false;
    };

  utterance.onerror =
    () => {

      speechBusy = false;
    };

  window.speechSynthesis.speak(
    utterance
  );
}

function runAd() {

  if (
    !ads.length ||
    adRunning
  ) {

    current =
      (current + 1) %
      stories.length;

    renderStory();

    return;
  }

  adRunning = true;

  if (
    'speechSynthesis'
    in window
  ) {

    window.speechSynthesis.cancel();

    speechBusy = false;
  }

  const ad =
    ads[
      Math.floor(
        Math.random() *
        ads.length
      )
    ] || {};

  const overlay =
    el('adOverlay');

  setText(
    'adTitle',

    ad.title ||
      'Voice of Peace'
  );

  setText(
    'adText',

    ad.text ||
      ad.message ||
      'We will return after this short message.'
  );

  if (overlay) {

    overlay.hidden =
      false;

    overlay.classList.add(
      'show'
    );
  }

  let remaining =
    AD_SECONDS;

  setText(
    'adCountdown',
    String(remaining)
  );

  const adTimer =
    setInterval(() => {

      remaining -= 1;

      setText(
        'adCountdown',

        String(
          Math.max(
            0,
            remaining
          )
        )
      );

      if (
        remaining <= 0
      ) {

        clearInterval(
          adTimer
        );

        if (overlay) {

          overlay.classList.remove(
            'show'
          );

          overlay.hidden =
            true;
        }

        adRunning =
          false;

        current =
          (current + 1) %
          stories.length;

        renderStory();
      }

    }, 1000);
}

function bindControls() {

  const prev =
    el('prevBtn');

  const next =
    el('nextBtn');

  const play =
    el('playBtn');

  const sound =
    el('soundBtn');

  if (prev) {

    prev.addEventListener(
      'click',
      previousStory
    );
  }

  if (next) {

    next.addEventListener(
      'click',

      () =>
        nextStory(true)
    );
  }

  if (play) {

    play.addEventListener(
      'click',
      togglePlay
    );
  }

  if (sound) {

    sound.addEventListener(
      'click',
      toggleSound
    );
  }

  document.addEventListener(
    'visibilitychange',
    () => {

      if (
        document.hidden
      ) {

        if (
          'speechSynthesis'
          in window
        ) {

          window.speechSynthesis.cancel();

          speechBusy =
            false;
        }

      } else if (
        playing
      ) {

        speakStory(
          currentStory()
        );
      }
    }
  );
}

async function init() {

  setLiveStatus(
    'connecting',
    'Voice of Peace • Connecting to live news'
  );

  stories =
    [EMERGENCY_STORY];

  renderStory();

  bindControls();

  startTimer();

  await loadFallbackData();

  /*
    Do not freeze the broadcast
    while live news is loading.
  */

  loadLiveNews();
}


/*
  Manual live-news reload.

  You can call:
  voiceOfPeaceReloadLive()
*/

window.voiceOfPeaceReloadLive =
  loadLiveNews;


if (
  document.readyState ===
  'loading'
) {

  document.addEventListener(
    'DOMContentLoaded',
    init
  );

} else {

  init();
}

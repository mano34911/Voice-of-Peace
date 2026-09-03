/* =========================================================
   VOICE OF PEACE — app.js
   by Emmanuel & Camili Hileah
   ========================================================= */

'use strict';

const STORY_SECONDS = 22;
const AD_EVERY = 3;
const AD_SECONDS = 10;

const LIVE_REFRESH_MINUTES = 15;
const LIVE_RETRY_SECONDS = 45;

const LIVE_TIMEOUT_MS = 10000;
const JSONP_TIMEOUT_MS = 15000;
const FALLBACK_TIMEOUT_MS = 5000;

const LIVE_NEWS_BASE_URL =
  'https://api.gdeltproject.org/api/v2/doc/doc';

const LIVE_QUERIES = [
  'peace OR community OR diplomacy',
  '"New York" OR community',
  'world OR international'
];

let stories = [];
let fallbackStories = [];
let ads = [];

let current = 0;
let playing = true;
let elapsed = 0;
let timer = null;

let adRunning = false;
let storiesSinceAd = 0;

let liveRefreshTimer = null;
let liveRetryTimer = null;
let liveRequestInProgress = false;

let usingLiveNews = false;
let speechBusy = false;

const el = id => document.getElementById(id);

function firstElement(...selectors) {
  for (const selector of selectors) {
    try {
      const node = document.querySelector(selector);
      if (node) return node;
    } catch (_) {}
  }
  return null;
}

function setText(value, ...selectors) {
  const node = firstElement(...selectors);
  if (node) node.textContent = value == null ? '' : String(value);
}

function setWidth(percent, ...selectors) {
  const node = firstElement(...selectors);
  if (node) {
    node.style.width =
      `${Math.max(0, Math.min(100, percent))}%`;
  }
}

const EMERGENCY_STORY = {
  id: 'emergency-001',
  category: 'Voice of Peace',
  headline: 'Voice of Peace is ready',
  summary:
    'The broadcast is ready. Live news is being checked now. If the live service is temporarily unavailable, Voice of Peace will continue automatically and try again.',
  source_line:
    'Voice of Peace • Connecting to live news',
  source_url: '',
  image: '',
  reflection: {
    verse_text:
      'Love your neighbor as yourself',
    verse_reference:
      'Leviticus 19:18',
    message:
      'Peace begins with the way we speak, listen, and care for one another.'
  }
};

function setStatus(mode, message) {

  const badge = firstElement(
    '#statusBadge',
    '#liveStatus',
    '#status',
    '.status-badge',
    '[data-live-status]'
  );

  const reporting = firstElement(
    '#reporting',
    '#reportingText',
    '#sourceStatus',
    '[data-reporting]'
  );

  const normalized =
    String(mode || '').toUpperCase();

  if (badge) {

    badge.textContent = normalized;

    badge.classList.remove(
      'live',
      'retrying',
      'offline',
      'connecting',
      'backup'
    );

    if (normalized === 'LIVE') {
      badge.classList.add('live');
    } else if (normalized === 'RETRYING') {
      badge.classList.add('retrying');
    } else {
      badge.classList.add('connecting');
    }
  }

  if (reporting && message) {
    reporting.textContent = message;
  }

  console.log(
    `[Voice of Peace] ${normalized}: ${message || ''}`
  );
}

async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = 10000
) {

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );

  try {

    const response =
      await fetch(url, {
        ...options,
        signal: controller.signal
      });

    return response;

  } finally {

    clearTimeout(timeout);
  }
}

async function loadFallbackData() {

  try {

    const response =
      await fetchWithTimeout(
        `data/sample-news.json?v=${Date.now()}`,
        { cache: 'no-store' },
        FALLBACK_TIMEOUT_MS
      );

    if (!response.ok) {
      throw new Error(
        `Backup news HTTP ${response.status}`
      );
    }

    const data =
      await response.json();

    fallbackStories =
      Array.isArray(data.stories) &&
      data.stories.length
        ? data.stories.map(normalizeStory)
        : [EMERGENCY_STORY];

    ads =
      Array.isArray(data.ads)
        ? data.ads
        : [];

    if (!stories.length || !usingLiveNews) {

      stories =
        [...fallbackStories];

      current =
        Math.min(
          current,
          stories.length - 1
        );

      renderCurrentStory();
    }

    return true;

  } catch (error) {

    console.warn(
      '[Voice of Peace] Backup file could not load:',
      error
    );

    fallbackStories =
      [EMERGENCY_STORY];

    if (!stories.length) {

      stories =
        [EMERGENCY_STORY];

      current = 0;

      renderCurrentStory();
    }

    return false;
  }
}

function makeGdeltUrl(
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

  if (
    format === 'jsonp' &&
    callbackName
  ) {

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

async function fetchGdeltJson(query) {

  const url =
    makeGdeltUrl(
      query,
      'json'
    );

  const response =
    await fetchWithTimeout(
      url,
      {
        cache: 'no-store',
        mode: 'cors',
        headers: {
          Accept:
            'application/json,text/plain,*/*'
        }
      },
      LIVE_TIMEOUT_MS
    );

  if (!response.ok) {

    throw new Error(
      `GDELT HTTP ${response.status}`
    );
  }

  const text =
    await response.text();

  if (!text || !text.trim()) {

    throw new Error(
      'GDELT returned an empty response'
    );
  }

  try {

    return JSON.parse(text);

  } catch (_) {

    throw new Error(
      'GDELT did not return valid JSON'
    );
  }
}

function fetchGdeltJsonp(query) {

  return new Promise(
    (resolve, reject) => {

      const callbackName =
        `voiceOfPeaceGdelt_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2)}`;

      const script =
        document.createElement('script');

      let finished = false;

      const cleanup = () => {

        if (script.parentNode) {
          script.parentNode.removeChild(
            script
          );
        }

        try {
          delete window[callbackName];
        } catch (_) {
          window[callbackName] =
            undefined;
        }
      };

      const timeout =
        setTimeout(() => {

          if (finished) return;

          finished = true;

          cleanup();

          reject(
            new Error(
              'GDELT JSONP timed out'
            )
          );

        }, JSONP_TIMEOUT_MS);

      window[callbackName] =
        data => {

          if (finished) return;

          finished = true;

          clearTimeout(timeout);

          cleanup();

          resolve(data);
        };

      script.onerror =
        () => {

          if (finished) return;

          finished = true;

          clearTimeout(timeout);

          cleanup();

          reject(
            new Error(
              'GDELT JSONP script failed'
            )
          );
        };

      script.async = true;

      script.referrerPolicy =
        'no-referrer';

      script.src =
        makeGdeltUrl(
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

function cleanText(value) {

  if (value == null) return '';

  const temp =
    document.createElement(
      'textarea'
    );

  temp.innerHTML =
    String(value);

  return temp.value
    .replace(/\s+/g, ' ')
    .replace(/\u0000/g, '')
    .trim();
}

function safeHost(url) {

  try {

    return new URL(url)
      .hostname
      .replace(/^www\./i, '');

  } catch (_) {

    return '';
  }
}

function titleToSummary(
  title,
  source
) {

  const cleanedTitle =
    cleanText(title);

  const cleanedSource =
    cleanText(source);

  if (!cleanedTitle) {

    return (
      'A new report has been published and is being followed by Voice of Peace.'
    );
  }

  return cleanedSource
    ? `${cleanedTitle}. Reported by ${cleanedSource}.`
    : `${cleanedTitle}.`;
}

function buildReflection(article) {

  const title =
    `${article.title || ''} ${article.domain || ''}`
      .toLowerCase();

  if (
    title.includes('war') ||
    title.includes('attack') ||
    title.includes('conflict') ||
    title.includes('violence')
  ) {

    return {
      verse_text:
        'Seek peace and pursue it',
      verse_reference:
        'Psalm 34:15',
      message:
        'Even during conflict, every effort toward protecting life, truth, and reconciliation matters.'
    };
  }

  if (
    title.includes('community') ||
    title.includes('neighbor') ||
    title.includes('charity') ||
    title.includes('help')
  ) {

    return {
      verse_text:
        'Love your neighbor as yourself',
      verse_reference:
        'Leviticus 19:18',
      message:
        'Strong communities are built when people treat one another with dignity, compassion, and responsibility.'
    };
  }

  return {
    verse_text:
      'Depart from evil and do good; seek peace and pursue it',
    verse_reference:
      'Psalm 34:15',
    message:
      'News tells us what is happening. Our responsibility is to respond with wisdom, compassion, and a commitment to peace.'
  };
}

function normalizeLiveArticle(
  article,
  index
) {

  const url =
    cleanText(
      article.url ||
      article.url_mobile ||
      ''
    );

  const domain =
    cleanText(
      article.domain || ''
    ) ||
    safeHost(url) ||
    'News source';

  const title =
    cleanText(
      article.title ||
      article.name ||
      article.headline ||
      'Latest world report'
    );

  const language =
    cleanText(
      article.language || ''
    );

  return {

    id:
      cleanText(
        article.seendate ||
        article.date ||
        ''
      ) +
      '-' +
      index +
      '-' +
      Math.random()
        .toString(36)
        .slice(2, 8),

    category:
      language &&
      language.toLowerCase() !==
        'english'
        ? 'World News'
        : 'Latest News',

    headline:
      title,

    summary:
      titleToSummary(
        title,
        domain
      ),

    source_line:
      `Source: ${domain} • Live via GDELT`,

    source_url:
      url,

    image:
      cleanText(
        article.socialimage ||
        article.image ||
        article.imageurl ||
        ''
      ),

    date:
      cleanText(
        article.seendate ||
        article.date ||
        article.datetime ||
        ''
      ),

    reflection:
      buildReflection(article)
  };
}

function normalizeStory(story) {

  if (
    !story ||
    typeof story !== 'object'
  ) {

    return {
      ...EMERGENCY_STORY
    };
  }

  return {

    id:
      story.id ||
      `story-${Date.now()}-${Math.random()}`,

    category:
      cleanText(
        story.category ||
        'Voice of Peace'
      ),

    headline:
      cleanText(
        story.headline ||
        story.title ||
        'Voice of Peace'
      ),

    summary:
      cleanText(
        story.summary ||
        story.description ||
        'Voice of Peace continues its broadcast.'
      ),

    source_line:
      cleanText(
        story.source_line ||
        story.source ||
        'Voice of Peace'
      ),

    source_url:
      cleanText(
        story.source_url ||
        story.url ||
        ''
      ),

    image:
      cleanText(
        story.image ||
        story.socialimage ||
        ''
      ),

    reflection: {

      verse_text:
        cleanText(
          story.reflection?.verse_text ||
          'Love your neighbor as yourself'
        ),

      verse_reference:
        cleanText(
          story.reflection?.verse_reference ||
          'Leviticus 19:18'
        ),

      message:
        cleanText(
          story.reflection?.message ||
          'Peace begins with the way we treat one another.'
        )
    }
  };
}

function parseLiveStories(data) {

  if (
    !data ||
    typeof data !== 'object'
  ) {
    return [];
  }

  let articles = [];

  if (
    Array.isArray(data.articles)
  ) {

    articles =
      data.articles;

  } else if (
    Array.isArray(data.results)
  ) {

    articles =
      data.results;

  } else if (
    Array.isArray(data.items)
  ) {

    articles =
      data.items;
  }

  return articles

    .filter(article => {

      const title =
        cleanText(
          article?.title ||
          article?.headline ||
          ''
        );

      const url =
        cleanText(
          article?.url ||
          article?.url_mobile ||
          ''
        );

      return title && url;
    })

    .map(normalizeLiveArticle)

    .filter(
      story =>
        story.headline.length > 4
    );
}

async function tryOneLiveQuery(
  query
) {

  try {

    console.log(
      '[Voice of Peace] Trying GDELT JSON:',
      query
    );

    const data =
      await fetchGdeltJson(query);

    const parsed =
      parseLiveStories(data);

    if (parsed.length) {
      return parsed;
    }

  } catch (error) {

    console.warn(
      '[Voice of Peace] GDELT JSON failed:',
      error
    );
  }

  try {

    console.log(
      '[Voice of Peace] Trying GDELT JSONP:',
      query
    );

    const data =
      await fetchGdeltJsonp(query);

    const parsed =
      parseLiveStories(data);

    if (parsed.length) {
      return parsed;
    }

  } catch (error) {

    console.warn(
      '[Voice of Peace] GDELT JSONP failed:',
      error
    );
  }

  return [];
}

async function loadLiveNews() {

  if (liveRequestInProgress) {
    return false;
  }

  liveRequestInProgress = true;

  clearTimeout(
    liveRetryTimer
  );

  liveRetryTimer = null;

  if (!usingLiveNews) {

    setStatus(
      'RETRYING',
      'Voice of Peace • Connecting to live news'
    );
  }

  try {

    for (
      const query of LIVE_QUERIES
    ) {

      const liveStories =
        await tryOneLiveQuery(
          query
        );

      if (liveStories.length) {

        stories =
          liveStories;

        usingLiveNews =
          true;

        current = 0;
        elapsed = 0;
        storiesSinceAd = 0;
        adRunning = false;

        setStatus(
          'LIVE',
          `Voice of Peace • Live news • ${liveStories.length} reports loaded`
        );

        renderCurrentStory();

        return true;
      }
    }

    throw new Error(
      'All live-news queries returned no usable stories'
    );

  } catch (error) {

    console.warn(
      '[Voice of Peace] Live news unavailable:',
      error
    );

    usingLiveNews =
      false;

    if (
      fallbackStories.length
    ) {

      stories =
        [...fallbackStories];

    } else if (
      !stories.length
    ) {

      stories =
        [EMERGENCY_STORY];
    }

    if (
      current >= stories.length
    ) {
      current = 0;
    }

    setStatus(
      'RETRYING',
      `Voice of Peace • Live service unavailable • Retrying in ${LIVE_RETRY_SECONDS} seconds`
    );

    renderCurrentStory();

    liveRetryTimer =
      setTimeout(
        loadLiveNews,
        LIVE_RETRY_SECONDS *
          1000
      );

    return false;

  } finally {

    liveRequestInProgress =
      false;
  }
}

function renderCurrentStory() {

  if (!stories.length) {
    stories =
      [EMERGENCY_STORY];
  }

  if (
    current < 0 ||
    current >= stories.length
  ) {
    current = 0;
  }

  const story =
    normalizeStory(
      stories[current]
    );

  setText(
    story.category,
    '#category',
    '#storyCategory',
    '[data-story-category]'
  );

  setText(
    story.headline,
    '#headline',
    '#storyHeadline',
    '[data-story-headline]'
  );

  setText(
    story.summary,
    '#summary',
    '#storySummary',
    '[data-story-summary]'
  );

  setText(
    story.source_line,
    '#sourceLine',
    '#source',
    '#storySource',
    '[data-story-source]'
  );

  setText(
    story.reflection.verse_text,
    '#verseText',
    '[data-verse-text]'
  );

  setText(
    story.reflection.verse_reference,
    '#verseReference',
    '[data-verse-reference]'
  );

  setText(
    story.reflection.message,
    '#reflectionMessage',
    '#reflection',
    '[data-reflection-message]'
  );

  const counter =
    firstElement(
      '#storyCounter',
      '#counter',
      '[data-story-counter]'
    );

  if (counter) {

    counter.textContent =
      `${current + 1} / ${Math.max(
        stories.length,
        1
      )}`;
  }

  updateProgress();
}

function renderAd(ad) {

  if (!ad) return false;

  const headline =
    cleanText(
      ad.headline ||
      ad.title ||
      ad.name ||
      'Voice of Peace'
    );

  const summary =
    cleanText(
      ad.summary ||
      ad.message ||
      ad.description ||
      'A short message from Voice of Peace.'
    );

  setText(
    'ADVERTISEMENT',
    '#category',
    '#storyCategory',
    '[data-story-category]'
  );

  setText(
    headline,
    '#headline',
    '#storyHeadline',
    '[data-story-headline]'
  );

  setText(
    summary,
    '#summary',
    '#storySummary',
    '[data-story-summary]'
  );

  setText(
    cleanText(
      ad.source_line ||
      ad.sponsor ||
      'Voice of Peace'
    ),
    '#sourceLine',
    '#source',
    '#storySource',
    '[data-story-source]'
  );

  updateProgress();

  return true;
}

function shouldRunAd() {

  return (
    ads.length > 0 &&
    !adRunning &&
    storiesSinceAd >=
      AD_EVERY
  );
}

function startAd() {

  if (!shouldRunAd()) {
    return false;
  }

  const ad =
    ads[
      Math.floor(
        Math.random() *
        ads.length
      )
    ];

  adRunning = true;
  elapsed = 0;
  storiesSinceAd = 0;

  renderAd(ad);

  return true;
}

function nextStory() {

  if (!stories.length) {
    return;
  }

  if (adRunning) {

    adRunning = false;
    elapsed = 0;

    current =
      (current + 1) %
      stories.length;

    renderCurrentStory();

    return;
  }

  storiesSinceAd++;

  if (startAd()) {
    return;
  }

  current =
    (current + 1) %
    stories.length;

  elapsed = 0;

  renderCurrentStory();
}

function previousStory() {

  if (!stories.length) {
    return;
  }

  adRunning = false;
  elapsed = 0;

  current =
    (
      current -
      1 +
      stories.length
    ) %
    stories.length;

  renderCurrentStory();
}

function currentDurationSeconds() {

  return adRunning
    ? AD_SECONDS
    : STORY_SECONDS;
}

function updateProgress() {

  const duration =
    currentDurationSeconds();

  const percent =
    duration > 0
      ? (elapsed / duration) *
        100
      : 0;

  setWidth(
    percent,
    '#progressFill',
    '.progress-fill',
    '[data-progress-fill]'
  );

  setText(
    `${Math.max(
      0,
      Math.ceil(
        duration - elapsed
      )
    )}s`,
    '#timeRemaining',
    '[data-time-remaining]'
  );
}

function tick() {

  if (!playing) {
    return;
  }

  elapsed += 1;

  if (
    elapsed >=
    currentDurationSeconds()
  ) {

    nextStory();

  } else {

    updateProgress();
  }
}

function startTimer() {

  clearInterval(timer);

  timer =
    setInterval(
      tick,
      1000
    );
}

function stopSpeech() {

  if (
    'speechSynthesis'
    in window
  ) {

    window
      .speechSynthesis
      .cancel();
  }

  speechBusy = false;
}

function speakCurrentStory() {

  if (
    speechBusy ||
    !(
      'speechSynthesis'
      in window
    ) ||
    adRunning ||
    !stories.length
  ) {

    return;
  }

  const story =
    normalizeStory(
      stories[current]
    );

  const text =
    `${story.headline}. ` +
    `${story.summary}. ` +
    `${story.reflection.verse_text}. ` +
    `${story.reflection.verse_reference}. ` +
    `${story.reflection.message}`;

  const utterance =
    new SpeechSynthesisUtterance(
      text
    );

  utterance.rate = 0.95;
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

  window
    .speechSynthesis
    .speak(utterance);
}

window.addEventListener(
  'online',
  () => {

    clearTimeout(
      liveRetryTimer
    );

    liveRetryTimer = null;

    loadLiveNews();
  }
);

window.addEventListener(
  'offline',
  () => {

    usingLiveNews = false;

    setStatus(
      'RETRYING',
      'Voice of Peace • Internet connection unavailable • Waiting to reconnect'
    );

    if (
      fallbackStories.length
    ) {

      stories =
        [...fallbackStories];

      current = 0;

      renderCurrentStory();
    }
  }
);

function startLiveRefresh() {

  clearInterval(
    liveRefreshTimer
  );

  liveRefreshTimer =
    setInterval(
      () => {
        loadLiveNews();
      },
      LIVE_REFRESH_MINUTES *
        60 *
        1000
    );
}

async function initVoiceOfPeace() {

  console.log(
    '[Voice of Peace] Starting broadcast'
  );

  stories =
    [EMERGENCY_STORY];

  current = 0;

  renderCurrentStory();

  setStatus(
    'RETRYING',
    'Voice of Peace • Connecting to live news'
  );

  startTimer();

  await loadFallbackData();

  await loadLiveNews();

  startLiveRefresh();
}

if (
  document.readyState ===
  'loading'
) {

  document.addEventListener(
    'DOMContentLoaded',
    initVoiceOfPeace,
    { once: true }
  );

} else {

  initVoiceOfPeace();
}

window.VoiceOfPeace = {

  retry:
    loadLiveNews,

  next:
    nextStory,

  previous:
    previousStory,

  speak:
    speakCurrentStory,

  stopSpeech,

  status() {

    return {

      usingLiveNews,

      liveRequestInProgress,

      storyCount:
        stories.length,

      backupStoryCount:
        fallbackStories.length,

      adCount:
        ads.length,

      current,

      playing
    };
  }
};

const STORY_SECONDS = 22;
const AD_EVERY = 3;
const AD_SECONDS = 10;
const LIVE_REFRESH_MINUTES = 15;

const PRIMARY_TIMEOUT_MS = 12000;
const GDELT_TIMEOUT_MS = 10000;
const JSONP_TIMEOUT_MS = 15000;
const FALLBACK_TIMEOUT_MS = 5000;

const GOOGLE_NEWS_RSS =
  'https://news.google.com/rss/search?' +
  new URLSearchParams({
    q: 'peace OR community OR world OR "New York"',
    hl: 'en-US',
    gl: 'US',
    ceid: 'US:en'
  }).toString();

const RSS2JSON_URL =
  'https://api.rss2json.com/v1/api.json?rss_url=' +
  encodeURIComponent(GOOGLE_NEWS_RSS);

const GDELT_BASE_URL =
  'https://api.gdeltproject.org/api/v2/doc/doc';

const GDELT_QUERY =
  '(peace OR community OR world OR "New York")';

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
let currentLiveSource = '';

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

function setLiveBadge(state, text) {
  const badge = el('liveBadge');

  if (!badge) return;

  badge.textContent = text;

  badge.classList.remove(
    'is-live',
    'is-connecting',
    'is-backup',
    'is-error'
  );

  badge.classList.add(state);
}

function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  if (typeof AbortController === 'undefined') {
    return fetch(url, options);
  }

  const controller = new AbortController();

  const timeoutId = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  return fetch(url, {
    ...options,
    signal: controller.signal
  }).finally(() => clearTimeout(timeoutId));
}

function cleanText(value = '') {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#8216;|&#8217;/gi, "'")
    .replace(/&#8220;|&#8221;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function readableDate(value = '') {
  if (!value) return '';

  const directDate = new Date(value);

  if (!Number.isNaN(directDate.getTime())) {
    try {
      return directDate.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
    } catch {}
  }

  const text = String(value);

  const match = text.match(
    /^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?Z?$/
  );

  if (!match) {
    return cleanText(text);
  }

  const [
    ,
    year,
    month,
    day,
    hour = '00',
    minute = '00',
    second = '00'
  ] = match;

  const date = new Date(
    `${year}-${month}-${day}T${hour}:${minute}:${second}Z`
  );

  if (Number.isNaN(date.getTime())) {
    return cleanText(text);
  }

  try {
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  } catch {
    return cleanText(text);
  }
}

function makeReflection(article) {
  const text = [
    article.title || '',
    article.summary || '',
    article.description || '',
    article.content || '',
    article.sentence || '',
    article.excerpt || ''
  ]
    .join(' ')
    .toLowerCase();

  if (
    /(war|attack|violence|killed|shoot|bomb|conflict|assault|missile|hostage|airstrike|strike|dead|death)/.test(
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
    /(help|rescue|charity|volunteer|community|donat|kindness|aid|support|relief)/.test(
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

function splitGoogleNewsTitle(title = '') {
  const clean = cleanText(title);

  const lastDash = clean.lastIndexOf(' - ');

  if (lastDash <= 0) {
    return {
      headline: clean,
      publisher: ''
    };
  }

  return {
    headline: clean.slice(0, lastDash).trim(),
    publisher: clean.slice(lastDash + 3).trim()
  };
}

function rssItemToStory(item, index) {
  const parsedTitle =
    splitGoogleNewsTitle(item.title || '');

  const headline =
    parsedTitle.headline ||
    cleanText(item.title) ||
    'Latest news update';

  const publisher =
    parsedTitle.publisher ||
    cleanText(item.author) ||
    'Google News';

  let summary = cleanText(
    item.description ||
    item.content ||
    ''
  );

  if (
    !summary ||
    summary.length < 35 ||
    summary === cleanText(item.title)
  ) {
    summary =
      `Current report from ${publisher}. ` +
      'Open the reporting source for the complete article.';
  }

  if (summary.length > 520) {
    summary =
      summary.slice(0, 517).trimEnd() + '...';
  }

  const displayDate =
    readableDate(item.pubDate || '');

  const sourceBits = [
    'LIVE',
    `Source: ${publisher}`
  ];

  if (displayDate) {
    sourceBits.push(displayDate);
  }

  return {
    id:
      `rss-${index}-${item.guid || item.link || Date.now()}`,

    category:
      /new york/i.test(headline + ' ' + summary)
        ? 'New York'
        : 'Live News',

    headline,

    summary,

    source_line:
      sourceBits.join(' • '),

    source_url:
      item.link || '',

    reflection:
      makeReflection({
        title: headline,
        summary
      }),

    ticker:
      'LIVE NEWS • Truth before rumors • Peace • Love • Compassion • Respect'
  };
}

function normalizeRss2Json(data) {
  if (
    !data ||
    typeof data !== 'object' ||
    data.status !== 'ok' ||
    !Array.isArray(data.items)
  ) {
    return [];
  }

  return data.items
    .filter(item => item && item.title && item.link)
    .map(rssItemToStory)
    .slice(0, 20);
}

async function loadLiveNewsFromRss() {
  const url =
    RSS2JSON_URL +
    '&_=' +
    Date.now();

  const res = await fetchWithTimeout(
    url,
    {
      cache: 'no-store',
      credentials: 'omit',
      headers: {
        Accept: 'application/json'
      }
    },
    PRIMARY_TIMEOUT_MS
  );

  if (!res.ok) {
    throw new Error(
      `RSS live feed HTTP ${res.status}`
    );
  }

  const data = await res.json();

  if (
    data &&
    data.status === 'error'
  ) {
    throw new Error(
      data.message ||
      'RSS service returned an error.'
    );
  }

  const liveStories =
    normalizeRss2Json(data);

  if (!liveStories.length) {
    throw new Error(
      'RSS live feed returned no usable stories.'
    );
  }

  return liveStories;
}

function buildGdeltUrl(format = 'json') {
  const params =
    new URLSearchParams();

  params.set(
    'query',
    GDELT_QUERY
  );

  params.set(
    'mode',
    'artlist'
  );

  params.set(
    'maxrecords',
    '25'
  );

  params.set(
    'format',
    format
  );

  params.set(
    'timespan',
    '24h'
  );

  params.set(
    'sort',
    'datedesc'
  );

  return `${GDELT_BASE_URL}?${params.toString()}`;
}

function gdeltArticleToStory(article, index) {
  const title =
    cleanText(article.title) ||
    'Latest world news update';

  const domain =
    cleanText(article.domain || '');

  const sourceCountry =
    cleanText(article.sourcecountry || '');

  const language =
    cleanText(article.language || '');

  const seenDate =
    cleanText(article.seendate || '');

  const displayDate =
    readableDate(seenDate);

  const summary =
    cleanText(
      article.sentence ||
      article.description ||
      article.excerpt ||
      article.summary ||
      ''
    ) ||
    (
      domain
        ? `Current report published by ${domain}. Open the reporting source for the complete article.`
        : 'Current report from the live news feed. Open the reporting source for the complete article.'
    );

  const sourceBits = ['LIVE'];

  if (domain) {
    sourceBits.push(
      `Source: ${domain}`
    );
  }

  if (displayDate) {
    sourceBits.push(
      displayDate
    );
  }

  if (language) {
    sourceBits.push(
      language
    );
  }

  return {
    id:
      `gdelt-${index}-${seenDate || Date.now()}`,

    category:
      sourceCountry || 'Live News',

    headline:
      title,

    summary,

    source_line:
      sourceBits.join(' • '),

    source_url:
      article.url || '',

    reflection:
      makeReflection(article),

    ticker:
      'LIVE NEWS • Truth before rumors • Peace • Love • Compassion • Respect'
  };
}

function normalizeGdeltArticles(data) {
  if (
    !data ||
    typeof data !== 'object'
  ) {
    return [];
  }

  const articles =
    Array.isArray(data.articles)
      ? data.articles
      : Array.isArray(data.items)
        ? data.items
        : [];

  return articles
    .filter(
      article =>
        article &&
        article.title &&
        article.url
    )
    .map(gdeltArticleToStory)
    .slice(0, 20);
}

async function loadLiveNewsFromGdeltFetch() {
  const url =
    buildGdeltUrl('json') +
    '&_=' +
    Date.now();

  const res =
    await fetchWithTimeout(
      url,
      {
        cache: 'no-store',
        mode: 'cors',
        credentials: 'omit',
        headers: {
          Accept: 'application/json'
        }
      },
      GDELT_TIMEOUT_MS
    );

  if (!res.ok) {
    throw new Error(
      `GDELT JSON HTTP ${res.status}`
    );
  }

  const raw =
    await res.text();

  if (!raw.trim()) {
    throw new Error(
      'GDELT JSON returned an empty response.'
    );
  }

  let data;

  try {
    data =
      JSON.parse(raw);
  } catch {
    throw new Error(
      'GDELT JSON response was not valid JSON.'
    );
  }

  const liveStories =
    normalizeGdeltArticles(data);

  if (!liveStories.length) {
    throw new Error(
      'GDELT JSON returned no usable stories.'
    );
  }

  return liveStories;
}

function loadLiveNewsFromGdeltJsonp() {
  return new Promise(
    (resolve, reject) => {

      const callbackName =
        'voiceOfPeaceGdelt' +
        Date.now() +
        Math.random()
          .toString(36)
          .slice(2);

      const script =
        document.createElement('script');

      let finished = false;

      const cleanup = () => {
        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }

        try {
          delete window[callbackName];
        } catch {
          window[callbackName] = undefined;
        }
      };

      const timeoutId =
        setTimeout(() => {

          if (finished) return;

          finished = true;

          cleanup();

          reject(
            new Error(
              'GDELT JSONP timed out.'
            )
          );

        }, JSONP_TIMEOUT_MS);

      window[callbackName] =
        data => {

          if (finished) return;

          finished = true;

          clearTimeout(
            timeoutId
          );

          const liveStories =
            normalizeGdeltArticles(data);

          cleanup();

          if (!liveStories.length) {

            reject(
              new Error(
                'GDELT JSONP returned no usable stories.'
              )
            );

            return;
          }

          resolve(
            liveStories
          );
        };

      script.onerror =
        () => {

          if (finished) return;

          finished = true;

          clearTimeout(
            timeoutId
          );

          cleanup();

          reject(
            new Error(
              'GDELT JSONP script failed to load.'
            )
          );
        };

      const params =
        new URLSearchParams();

      params.set(
        'query',
        GDELT_QUERY
      );

      params.set(
        'mode',
        'artlist'
      );

      params.set(
        'maxrecords',
        '25'
      );

      params.set(
        'format',
        'jsonp'
      );

      params.set(
        'timespan',
        '24h'
      );

      params.set(
        'sort',
        'datedesc'
      );

      params.set(
        'callback',
        callbackName
      );

      params.set(
        '_',
        Date.now().toString()
      );

      script.src =
        `${GDELT_BASE_URL}?${params.toString()}`;

      script.async = true;

      document.head.appendChild(script);
    }
  );
}

async function loadLiveNews() {
  try {
    const result =
      await loadLiveNewsFromRss();

    currentLiveSource =
      'Google News RSS';

    console.log(
      'Voice of Peace connected using Google News RSS.'
    );

    return result;

  } catch (rssError) {

    console.warn(
      'Primary RSS live feed failed. Trying GDELT JSON...',
      rssError
    );
  }

  try {
    const result =
      await loadLiveNewsFromGdeltFetch();

    currentLiveSource =
      'GDELT JSON';

    console.log(
      'Voice of Peace connected using GDELT JSON.'
    );

    return result;

  } catch (gdeltFetchError) {

    console.warn(
      'GDELT JSON failed. Trying GDELT JSONP...',
      gdeltFetchError
    );
  }

  const result =
    await loadLiveNewsFromGdeltJsonp();

  currentLiveSource =
    'GDELT JSONP';

  console.log(
    'Voice of Peace connected using GDELT JSONP.'
  );

  return result;
}

async function loadFallbackData() {
  const url =
    './data/sample-news.json?v=' +
    Date.now();

  const res =
    await fetchWithTimeout(
      url,
      {
        cache: 'no-store'
      },
      FALLBACK_TIMEOUT_MS
    );

  if (!res.ok) {
    throw new Error(
      `Fallback news HTTP ${res.status}`
    );
  }

  const data =
    await res.json();

  fallbackStories =
    Array.isArray(data.stories)
      ? data.stories
      : [];

  ads =
    Array.isArray(data.ads)
      ? data.ads
      : [];

  return data;
}

function beginBroadcast(initialStories) {
  stories =
    Array.isArray(initialStories) &&
    initialStories.length
      ? initialStories
      : [EMERGENCY_STORY];

  current = 0;

  showStory(0);

  startTimer();
}

function setStoriesWithoutRestart(
  newStories,
  resetToFirst = false
) {
  if (
    !Array.isArray(newStories) ||
    !newStories.length
  ) {
    return;
  }

  stories =
    newStories;

  if (
    resetToFirst ||
    current >= stories.length
  ) {
    current = 0;
  }

  showStory(current);
}

async function loadData() {
  setLiveBadge(
    'is-connecting',
    'CONNECTING'
  );

  beginBroadcast(
    [EMERGENCY_STORY]
  );

  try {
    await loadFallbackData();

    if (
      fallbackStories.length &&
      !usingLiveNews
    ) {
      setStoriesWithoutRestart(
        fallbackStories,
        true
      );

      setLiveBadge(
        'is-backup',
        'BACKUP'
      );
    }

  } catch (err) {

    console.warn(
      'Fallback news unavailable:',
      err
    );
  }

  await refreshLiveNews(true);

  clearInterval(
    liveRefreshTimer
  );

  liveRefreshTimer =
    setInterval(
      () =>
        refreshLiveNews(false),

      LIVE_REFRESH_MINUTES *
        60 *
        1000
    );
}

async function refreshLiveNews(
  resetToFirstStory = false
) {
  setLiveBadge(
    usingLiveNews
      ? 'is-live'
      : 'is-connecting',

    usingLiveNews
      ? 'LIVE'
      : 'CONNECTING'
  );

  try {
    const refreshed =
      await loadLiveNews();

    if (!refreshed.length) {
      throw new Error(
        'Live feed returned no usable stories.'
      );
    }

    usingLiveNews =
      true;

    setStoriesWithoutRestart(
      refreshed,
      resetToFirstStory ||
        stories.length <= 1
    );

    setLiveBadge(
      'is-live',
      'LIVE'
    );

    console.log(
      `Voice of Peace loaded ${stories.length} live stories from ${currentLiveSource}.`
    );

  } catch (err) {

    console.warn(
      'All external live-news sources failed.',
      err
    );

    usingLiveNews =
      false;

    currentLiveSource =
      '';

    if (fallbackStories.length) {

      setStoriesWithoutRestart(
        fallbackStories,
        true
      );

      setLiveBadge(
        'is-backup',
        'BACKUP'
      );

    } else {

      setStoriesWithoutRestart(
        [EMERGENCY_STORY],
        true
      );

      setLiveBadge(
        'is-error',
        'RETRYING'
      );
    }
  }
}

function showStory(index) {
  if (!stories.length) {
    stories =
      [EMERGENCY_STORY];
  }

  current =
    (index + stories.length) %
    stories.length;

  const s =
    stories[current] ||
    EMERGENCY_STORY;

  const category =
    el('category');

  const headline =
    el('headline');

  const summary =
    el('summary');

  const sourceLine =
    el('sourceLine');

  const verse =
    el('verse');

  const reflection =
    el('reflection');

  const ticker =
    el('ticker');

  if (category) {
    category.textContent =
      (
        s.category ||
        'News'
      ).toUpperCase();
  }

  if (headline) {
    headline.textContent =
      s.headline || '';
  }

  if (summary) {
    summary.textContent =
      s.summary || '';
  }

  if (sourceLine) {

    sourceLine.textContent =
      s.source_line || '';

    if (s.source_url) {

      sourceLine.style.cursor =
        'pointer';

      sourceLine.title =
        'Open original news source';

      sourceLine.setAttribute(
        'role',
        'link'
      );

      sourceLine.tabIndex =
        0;

      sourceLine.onclick =
        () => {

          window.open(
            s.source_url,
            '_blank',
            'noopener,noreferrer'
          );
        };

      sourceLine.onkeydown =
        event => {

          if (
            event.key ===
              'Enter' ||
            event.key ===
              ' '
          ) {
            event.preventDefault();

            window.open(
              s.source_url,
              '_blank',
              'noopener,noreferrer'
            );
          }
        };

    } else {

      sourceLine.style.cursor =
        '';

      sourceLine.title =
        '';

      sourceLine.removeAttribute(
        'role'
      );

      sourceLine.removeAttribute(
        'tabindex'
      );

      sourceLine.onclick =
        null;

      sourceLine.onkeydown =
        null;
    }
  }

  if (s.reflection) {

    if (verse) {

      verse.textContent =
        `"${s.reflection.verse_text || ''}" — ` +
        `${s.reflection.verse_reference || ''}`;
    }

    if (reflection) {

      reflection.textContent =
        s.reflection.message ||
        '';
    }

  } else {

    if (verse) {
      verse.textContent =
        '';
    }

    if (reflection) {
      reflection.textContent =
        '';
    }
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

  timer =
    setInterval(() => {

      if (
        !playing ||
        adRunning
      ) {
        return;
      }

      elapsed += 1;

      updateProgress();

      if (
        elapsed >=
        STORY_SECONDS
      ) {

        const completedStoryNumber =
          current + 1;

        if (
          completedStoryNumber %
            AD_EVERY ===
          0
        ) {

          runAd(() =>
            showStory(
              current + 1
            )
          );

        } else {

          showStory(
            current + 1
          );
        }
      }

    }, 1000);
}

function updateProgress() {
  const progressBar =
    el('progressBar');

  if (!progressBar) {
    return;
  }

  const pct =
    Math.min(
      100,
      (
        elapsed /
        STORY_SECONDS
      ) * 100
    );

  progressBar.style.width =
    pct + '%';
}

function runAd(done) {
  if (adRunning) {
    return;
  }

  const adOverlay =
    el('adOverlay');

  const adTitle =
    el('adTitle');

  const adText =
    el('adText');

  const adCountdown =
    el('adCountdown');

  if (
    !adOverlay ||
    !adTitle ||
    !adText ||
    !adCountdown
  ) {
    done();
    return;
  }

  adRunning =
    true;

  const wasPlaying =
    playing;

  const ad =
    ads.length
      ? ads[
          Math.floor(
            Math.random() *
              ads.length
          )
        ]
      : {
          title:
            'Advertise on Voice of Peace',

          text:
            'Sponsored messages can appear between Voice of Peace stories.'
        };

  adTitle.textContent =
    ad.title ||
    'Voice of Peace';

  adText.textContent =
    ad.text || '';

  adOverlay.classList.remove(
    'hidden'
  );

  let remaining =
    AD_SECONDS;

  adCountdown.textContent =
    remaining;

  const adTimer =
    setInterval(() => {

      remaining -=
        1;

      adCountdown.textContent =
        Math.max(
          0,
          remaining
        );

      if (
        remaining <= 0
      ) {

        clearInterval(
          adTimer
        );

        adOverlay.classList.add(
          'hidden'
        );

        adRunning =
          false;

        playing =
          wasPlaying;

        const playBtn =
          el('playBtn');

        if (playBtn) {

          playBtn.textContent =
            playing
              ? 'Pause'
              : 'Play';
        }

        done();
      }

    }, 1000);
}

function speechSupported() {
  return (
    typeof window !==
      'undefined' &&
    'speechSynthesis' in
      window &&
    typeof window
      .SpeechSynthesisUtterance !==
      'undefined'
  );
}

function setSoundButtonMessage(
  message,
  restoreAfterMs = 2200
) {
  const soundBtn =
    el('soundBtn');

  if (!soundBtn) {
    return;
  }

  const original =
    soundBtn.dataset
      .originalLabel ||
    soundBtn.textContent ||
    'Read Aloud';

  soundBtn.dataset
    .originalLabel =
    original;

  soundBtn.textContent =
    message;

  if (
    restoreAfterMs > 0
  ) {

    setTimeout(() => {

      if (!speechBusy) {

        soundBtn.textContent =
          original;
      }

    }, restoreAfterMs);
  }
}

function chooseEnglishVoice() {
  if (!speechSupported()) {
    return null;
  }

  const voices =
    window.speechSynthesis
      .getVoices();

  if (
    !voices ||
    !voices.length
  ) {
    return null;
  }

  return (
    voices.find(
      voice =>
        /^en-US/i.test(
          voice.lang
        ) &&
        /Samantha|Ava|Alex|Google US English|Microsoft/i.test(
          voice.name
        )
    ) ||

    voices.find(
      voice =>
        /^en-US/i.test(
          voice.lang
        )
    ) ||

    voices.find(
      voice =>
        /^en/i.test(
          voice.lang
        )
    ) ||

    voices[0]
  );
}

function stopSpeech() {
  if (!speechSupported()) {
    return;
  }

  try {
    window.speechSynthesis
      .cancel();
  } catch {}

  speechBusy =
    false;

  const soundBtn =
    el('soundBtn');

  if (soundBtn) {

    soundBtn.textContent =
      soundBtn.dataset
        .originalLabel ||
      'Read Aloud';
  }
}

function readCurrentStory() {
  if (!stories.length) {
    return;
  }

  if (!speechSupported()) {

    setSoundButtonMessage(
      'Audio unavailable'
    );

    return;
  }

  const s =
    stories[current] ||
    EMERGENCY_STORY;

  const r =
    s.reflection || {};

  const script = [
    'Good morning. This is the Voice of Peace by Emmanuel and Camili Hileah.',

    s.headline || '',

    s.summary || '',

    s.source_line
      ? `Source. ${s.source_line}`
      : '',

    'Now, here is the Voice of Peace reflection.',

    r.verse_text
      ? `${r.verse_text}. ${r.verse_reference || ''}.`
      : '',

    r.message || '',

    'This is the Voice of Peace by Emmanuel and Camili Hileah. Peace begins with me. Peace begins with you.'
  ]
    .filter(Boolean)
    .join(' ');

  try {

    window.speechSynthesis
      .cancel();

    const utter =
      new SpeechSynthesisUtterance(
        script
      );

    const voice =
      chooseEnglishVoice();

    if (voice) {

      utter.voice =
        voice;

      utter.lang =
        voice.lang ||
        'en-US';

    } else {

      utter.lang =
        'en-US';
    }

    utter.rate =
      0.94;

    utter.pitch =
      1.0;

    utter.volume =
      1.0;

    utter.onstart =
      () => {

        speechBusy =
          true;

        setSoundButtonMessage(
          'Speaking…',
          0
        );
      };

    utter.onend =
      () => {

        speechBusy =
          false;

        const soundBtn =
          el('soundBtn');

        if (soundBtn) {

          soundBtn.textContent =
            soundBtn.dataset
              .originalLabel ||
            'Read Aloud';
        }
      };

    utter.onerror =
      event => {

        console.warn(
          'Speech playback failed:',
          event
        );

        speechBusy =
          false;

        setSoundButtonMessage(
          'Audio unavailable'
        );
      };

    try {

      window.speechSynthesis
        .resume();

    } catch {}

    window.speechSynthesis
      .speak(utter);

  } catch (err) {

    console.warn(
      'Speech playback unavailable:',
      err
    );

    speechBusy =
      false;

    setSoundButtonMessage(
      'Audio unavailable'
    );
  }
}

function setupButtons() {
  const prevBtn =
    el('prevBtn');

  const nextBtn =
    el('nextBtn');

  const playBtn =
    el('playBtn');

  const soundBtn =
    el('soundBtn');

  if (prevBtn) {

    prevBtn.addEventListener(
      'click',
      () => {

        stopSpeech();

        showStory(
          current - 1
        );
      }
    );
  }

  if (nextBtn) {

    nextBtn.addEventListener(
      'click',
      () => {

        stopSpeech();

        showStory(
          current + 1
        );
      }
    );
  }

  if (playBtn) {

    playBtn.addEventListener(
      'click',
      () => {

        playing =
          !playing;

        playBtn.textContent =
          playing
            ? 'Pause'
            : 'Play';

        if (
          speechSupported()
        ) {

          try {

            if (!playing) {

              window
                .speechSynthesis
                .pause();

            } else {

              window
                .speechSynthesis
                .resume();
            }

          } catch {}
        }
      }
    );
  }

  if (soundBtn) {

    soundBtn.dataset
      .originalLabel =
      soundBtn.textContent ||
      'Read Aloud';

    soundBtn.addEventListener(
      'click',
      () => {

        if (
          speechBusy &&
          speechSupported()
        ) {

          stopSpeech();

          return;
        }

        readCurrentStory();
      }
    );
  }
}

function prepareSpeechVoices() {
  if (!speechSupported()) {
    return;
  }

  try {

    window.speechSynthesis
      .getVoices();

    if (
      'onvoiceschanged' in
      window.speechSynthesis
    ) {

      window.speechSynthesis
        .onvoiceschanged =
        () => {

          window
            .speechSynthesis
            .getVoices();
        };
    }

  } catch {}
}

function startApp() {
  setupButtons();

  prepareSpeechVoices();

  loadData();
}

if (
  document.readyState ===
  'loading'
) {

  document.addEventListener(
    'DOMContentLoaded',
    startApp,
    {
      once: true
    }
  );

} else {

  startApp();
}

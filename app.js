const STORY_SECONDS = 22;
const AD_EVERY = 3;
const AD_SECONDS = 10;
const LIVE_REFRESH_MINUTES = 15;
const LIVE_RETRY_SECONDS = 45;
const LIVE_TIMEOUT_MS = 12000;
const FALLBACK_TIMEOUT_MS = 5000;

const RSS2JSON_BASE_URL =
  'https://api.rss2json.com/v1/api.json';

const LIVE_FEEDS = [
  {
    name: 'Peace & Diplomacy',
    category: 'Peace',
    url:
      'https://news.google.com/rss/search?q=peace+OR+diplomacy+OR+ceasefire&hl=en-US&gl=US&ceid=US:en'
  },
  {
    name: 'World News',
    category: 'World News',
    url:
      'https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en'
  },
  {
    name: 'New York',
    category: 'New York',
    url:
      'https://news.google.com/rss/search?q=%22New+York%22&hl=en-US&gl=US&ceid=US:en'
  }
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

const el = id =>
  document.getElementById(id);

const EMERGENCY_STORY = {
  id: 'emergency-001',
  category: 'Voice of Peace',
  headline: 'Voice of Peace is ready',
  summary:
    'The broadcast is ready. Live news is being checked now. If the live service is temporarily unavailable, Voice of Peace will continue automatically and try again.',
  source_line: 'Voice of Peace',
  reflection: {
    verse_text:
      'Love your neighbor as yourself.',
    verse_reference:
      'Leviticus 19:18',
    message:
      'Peace begins with the way we speak, listen, and treat one another.'
  }
};

function setText(
  id,
  value
) {
  const node = el(id);

  if (node) {
    node.textContent =
      value || '';
  }
}

function setLiveStatus(
  state,
  detail = ''
) {
  const badge =
    el('liveStatus') ||
    el('statusBadge') ||
    el('connectionStatus');

  const reporting =
    el('sourceLine') ||
    el('reportingText') ||
    el('reporting');

  const normalized =
    String(
      state || ''
    ).toLowerCase();

  if (badge) {
    badge.classList.remove(
      'live',
      'connecting',
      'offline'
    );

    if (
      normalized === 'live'
    ) {
      badge.textContent =
        'LIVE';

      badge.classList.add(
        'live'
      );
    } else if (
      normalized ===
      'connecting'
    ) {
      badge.textContent =
        'CONNECTING';

      badge.classList.add(
        'connecting'
      );
    } else {
      badge.textContent =
        'RETRYING';

      badge.classList.add(
        'offline'
      );
    }
  }

  if (
    reporting &&
    detail
  ) {
    reporting.textContent =
      detail;
  }
}

function withTimeout(
  promise,
  ms,
  label = 'Request'
) {
  return Promise.race([
    promise,

    new Promise(
      (
        _,
        reject
      ) => {
        setTimeout(
          () =>
            reject(
              new Error(
                `${label} timed out`
              )
            ),
          ms
        );
      }
    )
  ]);
}

function safeUrl(
  url
) {
  try {
    const parsed =
      new URL(url);

    return (
      parsed.protocol ===
      'https:'
        ? parsed.href
        : ''
    );
  } catch {
    return '';
  }
}

function cleanText(
  text
) {
  return String(
    text || ''
  )
    .replace(
      /<[^>]*>/g,
      ' '
    )
    .replace(
      /\s+/g,
      ' '
    )
    .trim();
}

function titleCase(
  value
) {
  return String(
    value || ''
  )
    .replace(
      /[_-]+/g,
      ' '
    )
    .replace(
      /\b\w/g,
      c =>
        c.toUpperCase()
    );
}

function normalizeRSSItem(
  item,
  index,
  feedInfo
) {
  const headline =
    cleanText(
      item?.title
    );

  if (!headline) {
    return null;
  }

  const description =
    cleanText(
      item?.description ||
      item?.content ||
      ''
    );

  const author =
    cleanText(
      item?.author ||
      feedInfo?.name ||
      'Live news'
    );

  const pubDate =
    cleanText(
      item?.pubDate ||
      ''
    );

  const url =
    safeUrl(
      item?.link ||
      ''
    );

  const thumbnail =
    safeUrl(
      item?.thumbnail ||
      item?.enclosure
        ?.link ||
      ''
    );

  let summary =
    description;

  if (!summary) {
    summary =
      `Latest report from ${author}.`;
  }

  if (
    summary.length >
    420
  ) {
    summary =
      summary
        .slice(
          0,
          417
        )
        .trim() +
      '...';
  }

  return {
    id:
      `rss-${Date.now()}-${index}`,

    category:
      feedInfo?.category ||
      'World News',

    headline,

    summary,

    source_line:
      `LIVE • ${author}${
        pubDate
          ? ` • ${pubDate}`
          : ''
      }`,

    url,

    image:
      thumbnail,

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

function extractRSSStories(
  payload,
  feedInfo
) {
  if (
    payload?.status !==
      'ok' ||
    !Array.isArray(
      payload?.items
    )
  ) {
    throw new Error(
      payload?.message ||
      'RSS service returned an invalid response'
    );
  }

  const seen =
    new Set();

  return payload.items
    .map(
      (
        item,
        index
      ) =>
        normalizeRSSItem(
          item,
          index,
          feedInfo
        )
    )
    .filter(Boolean)
    .filter(
      story => {
        const key =
          story.url ||
          story.headline.toLowerCase();

        if (
          seen.has(key)
        ) {
          return false;
        }

        seen.add(key);

        return true;
      }
    );
}

function buildRSS2JSONUrl(
  feedUrl
) {
  const params =
    new URLSearchParams({
      rss_url:
        feedUrl,
      _:
        String(
          Date.now()
        )
    });

  return (
    `${RSS2JSON_BASE_URL}?` +
    params.toString()
  );
}

async function fetchRSSFeed(
  feedInfo
) {
  const url =
    buildRSS2JSONUrl(
      feedInfo.url
    );

  console.log(
    'Voice of Peace loading:',
    feedInfo.name,
    url
  );

  const response =
    await withTimeout(
      fetch(
        url,
        {
          method:
            'GET',

          mode:
            'cors',

          cache:
            'no-store',

          headers: {
            Accept:
              'application/json'
          }
        }
      ),

      LIVE_TIMEOUT_MS,

      `${feedInfo.name} feed`
    );

  if (
    !response.ok
  ) {
    throw new Error(
      `${feedInfo.name} HTTP ${response.status}`
    );
  }

  const payload =
    await response.json();

  const result =
    extractRSSStories(
      payload,
      feedInfo
    );

  if (
    !result.length
  ) {
    throw new Error(
      `${feedInfo.name} returned no stories`
    );
  }

  return result;
}

function mergeUniqueStories(
  groups
) {
  const seen =
    new Set();

  const merged =
    [];

  for (
    const group of groups
  ) {
    for (
      const story of group
    ) {
      const key =
        story.url ||
        story.headline.toLowerCase();

      if (
        seen.has(key)
      ) {
        continue;
      }

      seen.add(key);

      merged.push(
        story
      );
    }
  }

  return merged;
}

async function loadLiveNews() {
  setLiveStatus(
    'connecting',
    'Voice of Peace • Connecting to live news'
  );

  const successfulGroups =
    [];

  const errors =
    [];

  const results =
    await Promise.allSettled(
      LIVE_FEEDS.map(
        feedInfo =>
          fetchRSSFeed(
            feedInfo
          )
      )
    );

  results.forEach(
    (
      result,
      index
    ) => {
      const feedInfo =
        LIVE_FEEDS[
          index
        ];

      if (
        result.status ===
        'fulfilled'
      ) {
        successfulGroups.push(
          result.value
        );

        console.log(
          `LIVE feed connected: ${feedInfo.name} (${result.value.length} stories)`
        );
      } else {
        const message =
          result.reason
            ?.message ||
          String(
            result.reason
          );

        errors.push(
          `${feedInfo.name}: ${message}`
        );

        console.warn(
          `Feed failed: ${feedInfo.name}`,
          result.reason
        );
      }
    }
  );

  const liveStories =
    mergeUniqueStories(
      successfulGroups
    );

  if (
    liveStories.length
  ) {
    stories =
      liveStories;

    usingLiveNews =
      true;

    current =
      Math.min(
        current,
        Math.max(
          0,
          stories.length -
            1
        )
      );

    const feedCount =
      successfulGroups.length;

    setLiveStatus(
      'live',
      `Voice of Peace • LIVE • ${stories.length} current reports • ${feedCount}/${LIVE_FEEDS.length} feeds connected`
    );

    renderStory();

    scheduleLiveRefresh();

    clearRetryTimer();

    return true;
  }

  usingLiveNews =
    false;

  console.error(
    'All live RSS feeds failed:',
    errors
  );

  if (
    fallbackStories.length
  ) {
    stories =
      [
        ...fallbackStories
      ];

    current =
      Math.min(
        current,
        Math.max(
          0,
          stories.length -
            1
        )
      );
  } else {
    stories =
      [
        EMERGENCY_STORY
      ];

    current =
      0;
  }

  setLiveStatus(
    'retrying',
    'Voice of Peace • Broadcast active • Live feeds unavailable • Retrying automatically'
  );

  renderStory();

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
            cache:
              'no-store'
          }
        ),

        FALLBACK_TIMEOUT_MS,

        'Fallback news'
      );

    if (
      !response.ok
    ) {
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
        [
          ...fallbackStories
        ];
    }
  } catch (
    err
  ) {
    console.warn(
      'Fallback data failed:',
      err
    );

    fallbackStories =
      [
        EMERGENCY_STORY
      ];

    if (
      !stories.length
    ) {
      stories =
        [
          EMERGENCY_STORY
        ];
    }
  }
}

function scheduleLiveRefresh() {
  if (
    liveRefreshTimer
  ) {
    clearInterval(
      liveRefreshTimer
    );
  }

  liveRefreshTimer =
    setInterval(
      () =>
        loadLiveNews(),

      LIVE_REFRESH_MINUTES *
        60 *
        1000
    );
}

function clearRetryTimer() {
  if (
    retryTimer
  ) {
    clearTimeout(
      retryTimer
    );

    retryTimer =
      null;
  }
}

function scheduleRetry() {
  clearRetryTimer();

  retryTimer =
    setTimeout(
      () =>
        loadLiveNews(),

      LIVE_RETRY_SECONDS *
        1000
    );
}

function currentStory() {
  return (
    stories[
      current
    ] ||
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
    story.headline ||
      ''
  );

  setText(
    'summary',
    story.summary ||
      ''
  );

  setText(
    'sourceLine',
    story.source_line ||
      ''
  );

  const reflection =
    story.reflection ||
    {};

  const verseText =
    reflection
      .verse_text ||
    'Seek peace and pursue it.';

  const verseRef =
    reflection
      .verse_reference ||
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
    el(
      'storyImage'
    ) ||
    el(
      'newsImage'
    );

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
  } else if (
    image
  ) {
    image.style.display =
      'none';
  }

  const link =
    el(
      'storyLink'
    ) ||
    el(
      'readMore'
    );

  if (link) {
    if (
      story.url
    ) {
      link.href =
        story.url;

      link.target =
        '_blank';

      link.rel =
        'noopener noreferrer';

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

  elapsed =
    0;

  updateProgress();

  if (
    !adRunning &&
    playing
  ) {
    speakStory(
      story
    );
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

  if (
    !manual
  ) {
    storyCounter +=
      1;

    if (
      ads.length &&
      AD_EVERY >
        0 &&
      storyCounter %
        AD_EVERY ===
        0
    ) {
      runAd();

      return;
    }
  }

  current =
    (
      current +
      1
    ) %
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
    el(
      'progressBar'
    );

  if (!bar) {
    return;
  }

  const percentage =
    Math.max(
      0,

      Math.min(
        100,

        (
          elapsed /
          STORY_SECONDS
        ) *
          100
      )
    );

  bar.style.width =
    `${percentage}%`;
}

function startTimer() {
  if (
    timer
  ) {
    clearInterval(
      timer
    );
  }

  timer =
    setInterval(
      () => {
        if (
          !playing ||
          adRunning
        ) {
          return;
        }

        elapsed +=
          0.25;

        updateProgress();

        if (
          elapsed >=
          STORY_SECONDS
        ) {
          elapsed =
            0;

          nextStory(
            false
          );
        }
      },
      250
    );
}

function togglePlay() {
  playing =
    !playing;

  const button =
    el(
      'playBtn'
    );

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
    'speechSynthesis'
      in window
  ) {
    window.speechSynthesis.cancel();

    speechBusy =
      false;
  } else if (
    playing
  ) {
    speakStory(
      currentStory()
    );
  }
}

function getSpeechEnabled() {
  const button =
    el(
      'soundBtn'
    );

  if (
    !button
  ) {
    return true;
  }

  return (
    button.dataset.sound !==
    'off'
  );
}

function toggleSound() {
  const button =
    el(
      'soundBtn'
    );

  if (
    !button
  ) {
    return;
  }

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
    'speechSynthesis'
      in window
  ) {
    window.speechSynthesis.cancel();

    speechBusy =
      false;
  } else {
    speakStory(
      currentStory()
    );
  }
}

function speakStory(
  story
) {
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

  if (
    !text
  ) {
    return;
  }

  window.speechSynthesis.cancel();

  const utterance =
    new SpeechSynthesisUtterance(
      text
    );

  utterance.rate =
    0.92;

  utterance.pitch =
    1;

  utterance.volume =
    1;

  utterance.onstart =
    () => {
      speechBusy =
        true;
    };

  utterance.onend =
    () => {
      speechBusy =
        false;
    };

  utterance.onerror =
    () => {
      speechBusy =
        false;
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
      (
        current +
        1
      ) %
      stories.length;

    renderStory();

    return;
  }

  adRunning =
    true;

  if (
    'speechSynthesis'
      in window
  ) {
    window.speechSynthesis.cancel();

    speechBusy =
      false;
  }

  const ad =
    ads[
      Math.floor(
        Math.random() *
        ads.length
      )
    ] || {};

  const overlay =
    el(
      'adOverlay'
    );

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

  if (
    overlay
  ) {
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
    String(
      remaining
    )
  );

  const adTimer =
    setInterval(
      () => {
        remaining -=
          1;

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
          remaining <=
          0
        ) {
          clearInterval(
            adTimer
          );

          if (
            overlay
          ) {
            overlay.classList.remove(
              'show'
            );

            overlay.hidden =
              true;
          }

          adRunning =
            false;

          current =
            (
              current +
              1
            ) %
            stories.length;

          renderStory();
        }
      },
      1000
    );
}

function bindControls() {
  const prev =
    el(
      'prevBtn'
    );

  const next =
    el(
      'nextBtn'
    );

  const play =
    el(
      'playBtn'
    );

  const sound =
    el(
      'soundBtn'
    );

  if (
    prev
  ) {
    prev.addEventListener(
      'click',
      previousStory
    );
  }

  if (
    next
  ) {
    next.addEventListener(
      'click',

      () =>
        nextStory(
          true
        )
    );
  }

  if (
    play
  ) {
    play.addEventListener(
      'click',
      togglePlay
    );
  }

  if (
    sound
  ) {
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
    [
      EMERGENCY_STORY
    ];

  renderStory();

  bindControls();

  startTimer();

  await loadFallbackData();

  loadLiveNews();
}

window.voiceOfPeaceReloadLive =
  loadLiveNews;

window.voiceOfPeaceTestLive =
  async function () {
    const report =
      [];

    for (
      const feedInfo of
        LIVE_FEEDS
    ) {
      try {
        const result =
          await fetchRSSFeed(
            feedInfo
          );

        report.push({
          feed:
            feedInfo.name,

          status:
            'LIVE',

          stories:
            result.length
        });
      } catch (
        err
      ) {
        report.push({
          feed:
            feedInfo.name,

          status:
            'FAILED',

          error:
            err?.message ||
            String(
              err
            )
        });
      }
    }

    console.table(
      report
    );

    return report;
  };

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

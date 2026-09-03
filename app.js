const STORY_SECONDS = 22;
const AD_EVERY = 3;
const AD_SECONDS = 10;

const LIVE_REFRESH_MINUTES = 15;
const LIVE_RETRY_SECONDS = 45;

const LIVE_TIMEOUT_MS = 10000;
const FALLBACK_TIMEOUT_MS = 5000;

const LIVE_NEWS_FILE =
  'data/live-news.json';

const FALLBACK_FILE =
  'data/sample-news.json';


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

  category:
    'Voice of Peace',

  headline:
    'Voice of Peace is ready',

  summary:
    'The broadcast is ready. Live news is being checked now. If live news is temporarily unavailable, Voice of Peace will continue automatically and try again.',

  source_line:
    'Voice of Peace',

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

  const node =
    el(id);

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
      normalized ===
      'live'
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
          () => {

            reject(
              new Error(
                `${label} timed out`
              )
            );

          },
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
      new URL(
        url,
        window.location.href
      );

    if (
      parsed.protocol ===
      'https:'
    ) {

      return parsed.href;
    }

    return '';

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


function normalizeStory(
  story,
  index
) {

  if (!story) {

    return null;
  }


  const headline =
    cleanText(
      story.headline ||
      story.title ||
      ''
    );


  if (!headline) {

    return null;
  }


  return {

    id:
      story.id ||
      `story-${Date.now()}-${index}`,

    category:
      cleanText(
        story.category ||
        'World News'
      ),

    headline,

    summary:
      cleanText(
        story.summary ||
        story.description ||
        'Latest report received by Voice of Peace.'
      ),

    source_line:
      cleanText(
        story.source_line ||
        story.source ||
        'LIVE • Voice of Peace'
      ),

    url:
      safeUrl(
        story.url ||
        story.link ||
        ''
      ),

    image:
      safeUrl(
        story.image ||
        ''
      ),

    reflection: {

      verse_text:
        cleanText(
          story.reflection
            ?.verse_text ||
          'Seek peace and pursue it.'
        ),

      verse_reference:
        cleanText(
          story.reflection
            ?.verse_reference ||
          'Psalm 34:14'
        ),

      message:
        cleanText(
          story.reflection
            ?.message ||
          'May knowledge lead us toward compassion, responsibility, and peace.'
        )
    }
  };
}


function normalizeStories(
  raw
) {

  if (
    !Array.isArray(raw)
  ) {

    return [];
  }


  const seen =
    new Set();


  return raw

    .map(
      normalizeStory
    )

    .filter(Boolean)

    .filter(
      story => {

        const key =
          (
            story.url ||
            story.headline
          ).toLowerCase();


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


async function fetchJsonFile(
  path,
  label
) {

  const separator =
    path.includes('?')
      ? '&'
      : '?';


  const url =
    `${path}${separator}v=${Date.now()}`;


  console.log(
    `Voice of Peace loading ${label}:`,
    url
  );


  const response =
    await withTimeout(

      fetch(
        url,
        {
          cache:
            'no-store'
        }
      ),

      LIVE_TIMEOUT_MS,

      label
    );


  if (
    !response.ok
  ) {

    throw new Error(
      `${label} HTTP ${response.status}`
    );
  }


  return response.json();
}


async function loadLiveNews() {

  setLiveStatus(
    'connecting',
    'Voice of Peace • Connecting to live news'
  );


  try {

    const data =
      await fetchJsonFile(
        LIVE_NEWS_FILE,
        'Live news'
      );


    const liveStories =
      normalizeStories(
        data?.stories
      );


    if (
      !liveStories.length
    ) {

      throw new Error(
        'Live news file contains no stories'
      );
    }


    stories =
      liveStories;


    usingLiveNews =
      true;


    current =
      Math.min(
        current,

        Math.max(
          0,
          stories.length - 1
        )
      );


    let updatedText =
      '';


    if (
      data?.updated
    ) {

      try {

        const updatedDate =
          new Date(
            data.updated
          );


        updatedText =
          ` • Updated ${updatedDate.toLocaleTimeString(
            [],
            {
              hour:
                '2-digit',

              minute:
                '2-digit'
            }
          )}`;

      } catch {

        updatedText =
          '';
      }
    }


    setLiveStatus(
      'live',

      `Voice of Peace • LIVE • ${stories.length} current reports${updatedText}`
    );


    console.log(
      `Voice of Peace LIVE: ${stories.length} stories loaded.`
    );


    renderStory();

    scheduleLiveRefresh();

    clearRetryTimer();


    return true;


  } catch (
    err
  ) {

    console.error(
      'Live news file failed:',
      err
    );


    usingLiveNews =
      false;


    if (
      fallbackStories.length
    ) {

      stories =
        [
          ...fallbackStories
        ];

    } else {

      stories =
        [
          EMERGENCY_STORY
        ];
    }


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

    scheduleRetry();


    return false;
  }
}


async function loadFallbackData() {

  try {

    const data =
      await fetchJsonFile(
        FALLBACK_FILE,
        'Fallback news'
      );


    fallbackStories =
      normalizeStories(
        data?.stories
      );


    ads =
      Array.isArray(
        data?.ads
      )
        ? data.ads
        : [];


    console.log(
      `Fallback stories loaded: ${fallbackStories.length}`
    );


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


    ads =
      [];
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

  } else if (
    image
  ) {

    image.style.display =
      'none';
  }


  const link =
    el('storyLink') ||
    el('readMore');


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


  if (
    !bar
  ) {

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


  if (
    button
  ) {

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

    .filter(
      Boolean
    )

    .join(
      '. '
    );


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

    try {

      const data =
        await fetchJsonFile(
          LIVE_NEWS_FILE,
          'Live news test'
        );


      const result =
        normalizeStories(
          data?.stories
        );


      console.log(
        'VOICE OF PEACE LIVE TEST SUCCESS'
      );


      console.log(
        `${result.length} stories found`
      );


      console.table(
        result.map(
          story => ({
            category:
              story.category,

            headline:
              story.headline
          })
        )
      );


      return result;


    } catch (
      err
    ) {

      console.error(
        'VOICE OF PEACE LIVE TEST FAILED',
        err
      );


      throw err;
    }
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

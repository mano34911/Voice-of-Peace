const STORY_SECONDS = 22;
const LIVE_REFRESH_MINUTES = 15;
const LIVE_RETRY_SECONDS = 45;

const LIVE_NEWS_FILE = 'data/live-news.json';
const FALLBACK_FILE = 'data/sample-news.json';

const DEFAULT_STORY_IMAGE = 'many.jpeg';

let stories = [];
let fallbackStories = [];

let current = 0;
let playing = true;
let elapsed = 0;
let timer = null;

let liveRefreshTimer = null;
let retryTimer = null;

let speechBusy = false;

/*
  IMPORTANT:
  Reflection is spoken only ONCE.
*/
let reflectionSpoken = false;


const el = id =>
  document.getElementById(id);


const EMERGENCY_STORY = {

  id: 'emergency-001',

  category: 'Voice of Peace',

  headline: 'Voice of Peace is ready',

  summary:
    'Connecting to the latest news reports.',

  source_line:
    'Voice of Peace',

  image: '',

  url: '',

  reflection: {

    verse_text:
      'Seek peace and pursue it.',

    verse_reference:
      'Psalm 34:14',

    message:
      'Even when the news is difficult, we can answer the world with truth, compassion, responsibility, and a commitment to peace.'
  }
};


function cleanText(value) {

  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


function safeUrl(value) {

  if (!value) {
    return '';
  }

  try {

    const url =
      new URL(
        value,
        window.location.href
      );

    if (
      url.protocol === 'https:'
    ) {
      return url.href;
    }

  } catch (e) {
  }

  return '';
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
      story.title
    );


  if (!headline) {
    return null;
  }


  return {

    id:
      story.id ||
      `story-${index}`,

    category:
      cleanText(
        story.category ||
        'News'
      ),

    headline,

    summary:
      cleanText(
        story.summary ||
        story.description ||
        ''
      ),

    source_line:
      cleanText(
        story.source_line ||
        story.source ||
        'Voice of Peace'
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
          story.reflection?.verse_text ||
          'Seek peace and pursue it.'
        ),

      verse_reference:
        cleanText(
          story.reflection?.verse_reference ||
          'Psalm 34:14'
        ),

      message:
        cleanText(
          story.reflection?.message ||
          'Even when the news is difficult, we can answer the world with truth, compassion, responsibility, and a commitment to peace.'
        )
    }
  };
}


function normalizeStories(raw) {

  if (!Array.isArray(raw)) {
    return [];
  }

  const used =
    new Set();


  return raw

    .map(normalizeStory)

    .filter(Boolean)

    .filter(story => {

      const key =
        (
          story.url ||
          story.headline
        ).toLowerCase();


      if (
        used.has(key)
      ) {

        return false;
      }


      used.add(key);

      return true;
    });
}


async function fetchJson(path) {

  const separator =
    path.includes('?')
      ? '&'
      : '?';


  const response =
    await fetch(
      path +
      separator +
      'v=' +
      Date.now(),
      {
        cache: 'no-store'
      }
    );


  if (!response.ok) {

    throw new Error(
      `HTTP ${response.status}`
    );
  }


  return response.json();
}


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
  text
) {

  const badge =
    el('liveStatus');


  if (badge) {

    badge.classList.remove(
      'live',
      'connecting',
      'offline'
    );


    if (state === 'live') {

      badge.textContent =
        'LIVE';

      badge.classList.add(
        'live'
      );

    } else if (
      state === 'connecting'
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


  if (text) {

    setText(
      'sourceLine',
      text
    );
  }
}


async function loadFallback() {

  try {

    const data =
      await fetchJson(
        FALLBACK_FILE
      );


    fallbackStories =
      normalizeStories(
        data?.stories
      );

  } catch (error) {

    fallbackStories =
      [
        EMERGENCY_STORY
      ];
  }
}


async function loadLiveNews() {

  setLiveStatus(
    'connecting',
    'Voice of Peace • Connecting to live news'
  );


  try {

    const data =
      await fetchJson(
        LIVE_NEWS_FILE
      );


    const result =
      normalizeStories(
        data?.stories
      );


    if (!result.length) {

      throw new Error(
        'No live stories'
      );
    }


    stories =
      result;


    if (
      current >= stories.length
    ) {

      current = 0;
    }


    setLiveStatus(
      'live',
      `Voice of Peace • LIVE • ${stories.length} reports`
    );


    renderStory();


    clearTimeout(
      retryTimer
    );


    if (
      liveRefreshTimer
    ) {

      clearInterval(
        liveRefreshTimer
      );
    }


    liveRefreshTimer =
      setInterval(
        loadLiveNews,
        LIVE_REFRESH_MINUTES *
          60 *
          1000
      );


  } catch (error) {

    console.error(
      'Live news error:',
      error
    );


    stories =
      fallbackStories.length
        ? [...fallbackStories]
        : [EMERGENCY_STORY];


    current = 0;


    setLiveStatus(
      'offline',
      'Voice of Peace • Retrying live news'
    );


    renderStory();


    clearTimeout(
      retryTimer
    );


    retryTimer =
      setTimeout(
        loadLiveNews,
        LIVE_RETRY_SECONDS *
          1000
      );
  }
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


  /*
    Expose story for the full-story box.
  */

  window.voiceOfPeaceCurrentStory =
    story;


  setText(
    'category',
    story.category
  );


  setText(
    'headline',
    story.headline
  );


  setText(
    'summary',
    story.summary
  );


  setText(
    'sourceLine',
    story.source_line
  );


  const reflection =
    story.reflection || {};


  setText(
    'verse',
    `“${
      reflection.verse_text ||
      'Seek peace and pursue it.'
    }” — ${
      reflection.verse_reference ||
      'Psalm 34:14'
    }`
  );


  setText(
    'reflection',
    reflection.message ||
    ''
  );


  const image =
    el('storyImage');


  if (image) {

    image.dataset.fallback =
      'no';


    image.onerror =
      function() {

        if (
          image.dataset.fallback ===
          'yes'
        ) {

          return;
        }


        image.dataset.fallback =
          'yes';


        image.src =
          DEFAULT_STORY_IMAGE;
      };


    image.src =
      story.image ||
      DEFAULT_STORY_IMAGE;


    image.style.display =
      'block';
  }


  const storyLink =
    el('storyLink');


  if (storyLink) {

    storyLink.href =
      story.url ||
      '#';


    storyLink.style.display =
      'inline-flex';
  }


  const strip =
    el('newsStripText');


  if (strip) {

    strip.textContent =
      story.headline;
  }


  elapsed = 0;

  updateProgress();


  if (playing) {

    speakStory(
      story
    );
  }
}


/*
==================================================
VOICE

THIS IS THE IMPORTANT FIX.

After the opening reflection, the voice
ONLY reads:

1. headline
2. summary

It DOES NOT read:
- category
- source
- "Peace"
- reflection after every story
==================================================
*/

function speakStory(story) {

  if (
    !playing ||
    speechBusy ||
    !speechEnabled() ||
    !(
      'speechSynthesis'
      in window
    )
  ) {

    return;
  }


  const speechParts = [];


  /*
    Reflection spoken ONE TIME ONLY.
  */

  if (
    !reflectionSpoken &&
    story.id !==
      EMERGENCY_STORY.id
  ) {

    const reflection =
      story.reflection || {};


    speechParts.push(
      'Voice of Peace Reflection'
    );


    speechParts.push(
      reflection.verse_text ||
      'Seek peace and pursue it.'
    );


    speechParts.push(
      reflection.verse_reference ||
      'Psalm 34:14'
    );


    speechParts.push(
      reflection.message ||
      'Even when the news is difficult, we can answer the world with truth, compassion, responsibility, and a commitment to peace.'
    );


    reflectionSpoken =
      true;
  }


  /*
    FROM NOW ON:
    ONLY HEADLINE + SUMMARY
  */

  speechParts.push(
    story.headline
  );


  if (story.summary) {

    speechParts.push(
      story.summary
    );
  }


  const text =
    speechParts
      .filter(Boolean)
      .join('. ');


  if (!text) {
    return;
  }


  window.speechSynthesis.cancel();


  const speech =
    new SpeechSynthesisUtterance(
      text
    );


  speech.rate =
    0.92;

  speech.pitch =
    1;

  speech.volume =
    1;


  speech.onstart =
    function() {

      speechBusy =
        true;
    };


  speech.onend =
    function() {

      speechBusy =
        false;
    };


  speech.onerror =
    function() {

      speechBusy =
        false;
    };


  window.speechSynthesis.speak(
    speech
  );
}


function speechEnabled() {

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


function previousStory() {

  if (!stories.length) {
    return;
  }


  window.speechSynthesis
    ?.cancel();


  speechBusy = false;


  current =
    (
      current -
      1 +
      stories.length
    ) %
    stories.length;


  renderStory();
}


function nextStory() {

  if (!stories.length) {
    return;
  }


  window.speechSynthesis
    ?.cancel();


  speechBusy = false;


  current =
    (
      current +
      1
    ) %
    stories.length;


  renderStory();
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
  }


  if (!playing) {

    window.speechSynthesis
      ?.cancel();

    speechBusy = false;

  } else {

    speakStory(
      currentStory()
    );
  }
}


function toggleSound() {

  const button =
    el('soundBtn');


  if (!button) {
    return;
  }


  const currentlyOff =
    button.dataset.sound ===
    'off';


  if (currentlyOff) {

    button.dataset.sound =
      'on';

    button.textContent =
      '🔊 Sound On';


    speakStory(
      currentStory()
    );

  } else {

    button.dataset.sound =
      'off';

    button.textContent =
      '🔇 Sound Off';


    window.speechSynthesis
      ?.cancel();


    speechBusy = false;
  }
}


function updateProgress() {

  const bar =
    el('progressBar');


  if (!bar) {
    return;
  }


  const percentage =
    Math.min(
      100,
      (
        elapsed /
        STORY_SECONDS
      ) *
      100
    );


  bar.style.width =
    percentage + '%';
}


function startTimer() {

  if (timer) {

    clearInterval(
      timer
    );
  }


  timer =
    setInterval(
      function() {

        if (!playing) {
          return;
        }


        elapsed +=
          0.25;


        updateProgress();


        if (
          elapsed >=
          STORY_SECONDS
        ) {

          nextStory();
        }

      },
      250
    );
}


function bindControls() {

  el('prevBtn')
    ?.addEventListener(
      'click',
      previousStory
    );


  el('nextBtn')
    ?.addEventListener(
      'click',
      nextStory
    );


  el('playBtn')
    ?.addEventListener(
      'click',
      togglePlay
    );


  el('soundBtn')
    ?.addEventListener(
      'click',
      toggleSound
    );
}


async function init() {

  stories =
    [
      EMERGENCY_STORY
    ];


  bindControls();

  startTimer();

  renderStory();


  await loadFallback();

  await loadLiveNews();
}


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

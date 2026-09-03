const STORY_SECONDS = 22;
const AD_EVERY = 3;
const AD_SECONDS = 10;

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

const el = id => document.getElementById(id);

async function loadFallbackData() {
  const res = await fetch('data/sample-news.json', {
    cache: 'no-store'
  });

  if (!res.ok) {
    throw new Error(`Fallback news HTTP ${res.status}`);
  }

  const data = await res.json();

  fallbackStories = Array.isArray(data.stories)
    ? data.stories
    : [];

  ads = Array.isArray(data.ads)
    ? data.ads
    : [];

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
    /(war|attack|violence|killed|shoot|bomb|conflict|assault)/.test(text)
  ) {
    return {
      verse_text: 'Seek peace and pursue it',
      verse_reference: 'Psalms 34:15',
      message:
        'Behind every headline are human lives. Voice of Peace calls for truth, restraint, protection of innocent people, and the courage to seek a path away from hatred and toward peace.'
    };
  }

  if (
    /(help|rescue|charity|volunteer|community|donat|kindness)/.test(text)
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
  const title =
    cleanText(article.title) ||
    'Latest world news update';

  const sentence = cleanText(
    article.sentence ||
    article.description ||
    article.excerpt ||
    ''
  );

  const domain = cleanText(
    article.domain || ''
  );

  const sourceCountry = cleanText(
    article.sourcecountry || ''
  );

  const seenDate = cleanText(
    article.seendate || ''
  );

  return {
    id: `live-${index}-${seenDate || Date.now()}`,

    category:
      sourceCountry || 'Live News',

    headline:
      title,

    summary:
      sentence ||
      `Latest report from ${
        domain || 'a news source'
      }. Tap the source below to read the complete report.`,

    source_line:
      `LIVE • Source: ${
        domain || 'news source'
      }` +
      (seenDate
        ? ` • ${seenDate}`
        : ''),

    source_url:
      article.url || '',

    reflection:
      makeReflection(article),

    ticker:
      'LIVE NEWS • Truth before rumors • Peace • Love • Compassion • Respect'
  };
}

async function loadLiveNews() {
  const res = await fetch(
    LIVE_NEWS_URL,
    {
      cache: 'no-store',
      headers: {
        Accept: 'application/json'
      }
    }
  );

  if (!res.ok) {
    throw new Error(
      `Live news HTTP ${res.status}`
    );
  }

  const data = await res.json();

  const articles =
    Array.isArray(data.articles)
      ? data.articles
      : [];

  return articles
    .filter(
      article =>
        article &&
        article.title &&
        article.url
    )
    .map(articleToStory)
    .slice(0, 20);
}

async function loadData() {
  try {
    await loadFallbackData();
  } catch (err) {
    console.warn(
      'Could not load fallback file:',
      err
    );

    fallbackStories = [];
    ads = [];
  }

  try {
    const liveStories =
      await loadLiveNews();

    if (liveStories.length) {
      stories = liveStories;

      console.log(
        `Voice of Peace loaded ${stories.length} live stories.`
      );
    } else {
      throw new Error(
        'Live feed returned no usable stories.'
      );
    }
  } catch (err) {
    console.warn(
      'Live feed unavailable. Using demo fallback.',
      err
    );

    stories = fallbackStories;
  }

  if (!stories.length) {
    throw new Error(
      'No live or fallback stories are available.'
    );
  }

  showStory(0);
  startTimer();

  // Refresh live news every 15 minutes
  setInterval(
    refreshLiveNews,
    15 * 60 * 1000
  );
}

async function refreshLiveNews() {
  try {
    const refreshed =
      await loadLiveNews();

    if (refreshed.length) {
      stories = refreshed;

      if (
        current >= stories.length
      ) {
        current = 0;
      }

      console.log(
        `Voice of Peace refreshed ${stories.length} live stories.`
      );
    }
  } catch (err) {
    console.warn(
      'Live news refresh failed; keeping current stories.',
      err
    );
  }
}

function showStory(index) {
  if (!stories.length) {
    return;
  }

  current =
    (index + stories.length) %
    stories.length;

  const s = stories[current];

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

      sourceLine.onclick = () =>
        window.open(
          s.source_url,
          '_blank',
          'noopener,noreferrer'
        );
    } else {
      sourceLine.style.cursor =
        '';

      sourceLine.title =
        '';

      sourceLine.onclick =
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

  timer = setInterval(
    () => {
      if (!playing) {
        return;
      }

      elapsed += 1;

      updateProgress();

      if (
        elapsed >= STORY_SECONDS
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
    },
    1000
  );
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
      (elapsed /
        STORY_SECONDS) *
        100
    );

  progressBar.style.width =
    pct + '%';
}

function runAd(done) {
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

  playing = false;

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
    setInterval(
      () => {
        remaining -= 1;

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

          playing = true;

          done();
        }
      },
      1000
    );
}

function readCurrentStory() {
  if (
    !(
      'speechSynthesis'
      in window
    ) ||
    !stories.length
  ) {
    alert(
      'Speech playback is not supported in this browser.'
    );

    return;
  }

  speechSynthesis.cancel();

  const s =
    stories[current];

  const reflection =
    s.reflection || {};

  const script = [
    'Good morning. This is the Voice of Peace by Emmanuel Hileah.',

    s.headline || '',

    s.summary || '',

    'Source.',

    s.source_line || '',

    'Now, here is the Voice of Peace reflection.',

    `${reflection.verse_text || ''}. ${reflection.verse_reference || ''}.`,

    reflection.message || '',

    'This is the Voice of Peace by Emmanuel Hileah. Peace begins with me. Peace begins with you.'
  ].join(' ');

  const utter =
    new SpeechSynthesisUtterance(
      script
    );

  utter.rate = 0.94;
  utter.pitch = 1.0;

  speechSynthesis.speak(
    utter
  );
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
      () =>
        showStory(
          current - 1
        )
    );
  }

  if (nextBtn) {
    nextBtn.addEventListener(
      'click',
      () =>
        showStory(
          current + 1
        )
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
          'speechSynthesis'
          in window
        ) {
          if (!playing) {
            speechSynthesis.pause();
          } else {
            speechSynthesis.resume();
          }
        }
      }
    );
  }

  if (soundBtn) {
    soundBtn.addEventListener(
      'click',
      readCurrentStory
    );
  }
}

function showFatalError(err) {
  console.error(err);

  const headline =
    el('headline');

  const summary =
    el('summary');

  const sourceLine =
    el('sourceLine');

  if (headline) {
    headline.textContent =
      'Unable to load the broadcast';
  }

  if (summary) {
    summary.textContent =
      'The live feed and the backup news file could not be loaded. Please check the GitHub files and try again.';
  }

  if (sourceLine) {
    sourceLine.textContent =
      'Voice of Peace • News connection error';
  }
}

document.addEventListener(
  'DOMContentLoaded',
  () => {
    setupButtons();

    loadData().catch(
      showFatalError
    );
  }
);

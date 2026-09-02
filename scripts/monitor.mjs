import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';

const WORLD = 'Antica';
const API_URL = `https://api.tibiadata.com/v4/world/${WORLD}`;
const OUT_PATH = 'data/status.json';

const WINDOW_START_MIN = 9 * 60 + 55; // 09:55
const WINDOW_END_MIN = 10 * 60 + 20;  // 10:20
const POLL_INTERVAL_MS = 5000;        // poll every 5s

// The job may start a bit early (to dodge GitHub's top-of-hour scheduling
// congestion). Allow it to wait up to this long for the window to open
// before giving up entirely.
const MAX_WAIT_MS = 20 * 60 * 1000; // give up waiting after 20 min
const WAIT_POLL_MS = 15 * 1000;     // check every 15s while waiting

function stockholmMinutesOfDay(date) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Stockholm',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = fmt.formatToParts(date);
  const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);
  return hour * 60 + minute;
}

function isWithinWindow(date) {
  const m = stockholmMinutesOfDay(date);
  return m >= WINDOW_START_MIN && m <= WINDOW_END_MIN;
}

function isPastWindow(date) {
  const m = stockholmMinutesOfDay(date);
  return m > WINDOW_END_MIN;
}

// How long from `now` until the window actually ends, used to size the
// polling loop dynamically instead of a fixed duration.
function msUntilWindowEnd(date) {
  const m = stockholmMinutesOfDay(date);
  const minsLeft = WINDOW_END_MIN - m;
  return Math.max(0, minsLeft * 60 * 1000);
}

async function fetchWorld() {
  const res = await fetch(API_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return data.world;
}

function loadExisting() {
  if (existsSync(OUT_PATH)) {
    try {
      return JSON.parse(readFileSync(OUT_PATH, 'utf-8'));
    } catch {
      return {};
    }
  }
  return {};
}

async function main() {
  const startedAt = new Date();
  console.log(
    'Job started at',
    startedAt.toISOString(),
    '| Stockholm time now:',
    Math.floor(stockholmMinutesOfDay(startedAt) / 60) + ':' +
      String(stockholmMinutesOfDay(startedAt) % 60).padStart(2, '0')
  );

  if (isPastWindow(startedAt)) {
    console.log('Already past the end of today\'s window. Exiting.');
    return;
  }

  const existing = loadExisting();
  const today = new Date().toISOString().slice(0, 10);

  // Don't re-detect if we already recorded a transition today
  if (existing.transitionDate && existing.transitionDate.slice(0, 10) === today) {
    console.log('Already recorded a transition today. Exiting.');
    return;
  }

  // If we started early (e.g. to dodge GitHub's top-of-hour congestion),
  // wait here until the real monitoring window opens.
  const waitStart = Date.now();
  while (!isWithinWindow(new Date())) {
    if (Date.now() - waitStart > MAX_WAIT_MS) {
      console.log('Waited too long for the window to open. Exiting.');
      return;
    }
    await new Promise(r => setTimeout(r, WAIT_POLL_MS));
  }

  console.log('Window is open. Beginning polling.');

  let previousStatus = null;
  let transitionISO = null;
  const pollStart = Date.now();
  const pollDuration = msUntilWindowEnd(new Date()) + 60 * 1000; // small buffer

  while (Date.now() - pollStart < pollDuration) {
    try {
      const world = await fetchWorld();
      const raw = (world.status || '').toLowerCase();
      const isOnline = raw.includes('online') && !raw.includes('offline');
      const current = isOnline ? 'online' : 'offline';

      if (previousStatus === 'offline' && current === 'online') {
        transitionISO = new Date().toISOString();
        console.log('Transition detected at', transitionISO);
        break; // found it, stop polling
      }

      previousStatus = current;
    } catch (err) {
      console.error('Poll failed:', err.message);
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  if (transitionISO) {
    mkdirSync('data', { recursive: true });
    writeFileSync(
      OUT_PATH,
      JSON.stringify({ transitionDate: transitionISO }, null, 2)
    );
    console.log('Wrote', OUT_PATH);
  } else {
    console.log('No transition observed this run.');
  }
}

main();

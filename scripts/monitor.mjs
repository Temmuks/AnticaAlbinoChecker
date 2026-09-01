import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';

const WORLD = 'Antica';
const API_URL = `https://api.tibiadata.com/v4/world/${WORLD}`;
const OUT_PATH = 'data/status.json';

const WINDOW_START_MIN = 9 * 60 + 55; // 09:55
const WINDOW_END_MIN = 10 * 60 + 20;  // 10:20
const POLL_INTERVAL_MS = 5000;        // poll every 5s
const RUN_DURATION_MS = 26 * 60 * 1000; // slightly longer than the window

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
  return m >= WINDOW_START_MIN - 2 && m <= WINDOW_END_MIN; // small buffer
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
  const now = new Date();
  if (!isWithinWindow(now)) {
    console.log('Not within monitoring window (wrong DST trigger). Exiting.');
    return;
  }

  const existing = loadExisting();
  const today = new Date().toISOString().slice(0, 10);

  // Don't re-detect if we already recorded a transition today
  if (existing.transitionDate && existing.transitionDate.slice(0, 10) === today) {
    console.log('Already recorded a transition today. Exiting.');
    return;
  }

  let previousStatus = null;
  let transitionISO = null;
  const start = Date.now();

  while (Date.now() - start < RUN_DURATION_MS) {
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

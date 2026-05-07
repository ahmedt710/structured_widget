// Schedule-based widget (no build step).
// Fetches NDJSON (one JSON per line), tracks current/next, renders countdown, backgrounds, progress, chimes.

const DEFAULT_SRC =
  "https://raw.githubusercontent.com/ahmedt710/structured/main/structured_json.txt";

const el = {
  app: document.getElementById("app"),
  taskTypePill: document.getElementById("taskTypePill"),
  widgetTitle: document.getElementById("widgetTitle"),
  subTitle: document.getElementById("subTitle"),
  bigTime: document.getElementById("bigTime"),
  smallLabel: document.getElementById("smallLabel"),
  currentTitle: document.getElementById("currentTitle"),
  metaLine: document.getElementById("metaLine"),
  banner: document.getElementById("banner"),
  alsoLine: document.getElementById("alsoLine"),
  timeline: document.getElementById("timeline"),
  timelineHint: document.getElementById("timelineHint"),
  timelineList: document.getElementById("timelineList"),
  footLeft: document.getElementById("footLeft"),
  footRight: document.getElementById("footRight"),
  btnEnableSound: document.getElementById("btnEnableSound"),
  btnTestChime: document.getElementById("btnTestChime"),
  btnMute: document.getElementById("btnMute"),
  btnEndEarly: document.getElementById("btnEndEarly"),
  btnSkipNext: document.getElementById("btnSkipNext"),
  volume: document.getElementById("volume"),
};

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function getQuery() {
  const p = new URLSearchParams(location.search);
  const num = (k, d) => {
    const v = p.get(k);
    if (v === null || v === "") return d;
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const str = (k, d) => {
    const v = p.get(k);
    return v === null || v === "" ? d : v;
  };
  const bool = (k, d) => {
    const v = p.get(k);
    if (v === null) return d;
    return v === "1" || v.toLowerCase() === "true";
  };

  return {
    src: str("src", DEFAULT_SRC),
    title: str("title", "Today"),
    theme: str("theme", "auto"),
    tz: str("tz", ""),
    notify: bool("notify", true),
    sound: bool("sound", true),
    volume: clamp01(num("volume", 0.35)),
    compact: bool("compact", false),
    hideTimeline: bool("hideTimeline", false),
    hideIcons: bool("hideIcons", false),
    hideColours: bool("hideColours", false),
    fontScale: Math.max(0.8, Math.min(1.2, num("fontScale", 1))),
    bgStudy: str("bgStudy", ""),
    bgBreak: str("bgBreak", ""),
    bgPray: str("bgPray", ""),
    bgOther: str("bgOther", ""),
    bgOpacity: clamp01(num("bgOpacity", 0.55)),
    bgBlurPx: Math.max(0, Math.min(12, num("bgBlurPx", 0))),
    refreshMs: Math.max(250, Math.min(2000, num("refreshMs", 1000))),
    fetchEveryMs: Math.max(30000, num("fetchEveryMs", 300000)),
  };
}

function formatHhMm(d, tz) {
  const opts = { hour: "numeric", minute: "2-digit" };
  if (tz) opts.timeZone = tz;
  return new Intl.DateTimeFormat(undefined, opts).format(d);
}

function formatDurationMs(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function parseNdjson(text) {
  const lines = text
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const events = [];
  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    const obj = safeJsonParse(lines[i]);
    if (!obj) {
      errors.push({ line: i + 1, reason: "Invalid JSON" });
      continue;
    }
    if (!obj.title || !obj.startTime || !obj.endTime) {
      errors.push({ line: i + 1, reason: "Missing title/startTime/endTime" });
      continue;
    }
    const start = new Date(obj.startTime);
    const end = new Date(obj.endTime);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      errors.push({ line: i + 1, reason: "Invalid start/end time" });
      continue;
    }
    events.push({
      raw: obj,
      title: String(obj.title),
      start,
      end,
      colour: obj.colour ? String(obj.colour) : "",
      icon: obj.icon ? String(obj.icon) : "",
      completed: obj.completed ? String(obj.completed) : "",
    });
  }

  events.sort((a, b) => a.start - b.start);
  return { events, errors };
}

function classifyTaskType(title) {
  const t = String(title || "").toLowerCase();
  const has = (x) => t.includes(x);

  if (
    has("prayer") ||
    has("fajr") ||
    has("dhuhr") ||
    has("asr") ||
    has("maghrib") ||
    has("isha")
  )
    return "pray";
  if (has("break") || has("wind down") || has("lunch")) return "break";
  if (has("mcat") || has("anki") || has("cars") || has("quran")) return "study";
  return "other";
}

function accentFromColour(colour) {
  // Simple mapping for your named colours. Fallback: a calming green.
  const c = String(colour || "").toLowerCase().replace(/\s+/g, "");
  const map = {
    darkgreen: "146 55% 45%",
    green: "142 60% 45%",
    orange: "28 85% 58%",
    yellow: "46 90% 60%",
    blue: "206 85% 62%",
    darkblue: "220 65% 55%",
    purple: "266 70% 66%",
    pink: "332 78% 66%",
  };
  return map[c] || "146 55% 45%";
}

function bgUrlForType(cfg, taskType) {
  const fromCfg = {
    study: cfg.bgStudy,
    break: cfg.bgBreak,
    pray: cfg.bgPray,
    other: cfg.bgOther,
  }[taskType];
  if (fromCfg) return `url("${fromCfg.replace(/"/g, '\\"')}")`;

  // Safe defaults (solid gradient only) if user doesn't provide images.
  // You can later drop images into the repo and switch these to local assets.
  return "none";
}

// ---------- Audio (soothing chime) ----------

/** @type {AudioContext | null} */
let audioCtx = null;
let audioUnlocked = false;

const audioState = {
  muted: false,
  volume: 0.35,
  lastChimeSecond: null, // number epoch seconds, dedupe across overlaps
};

function ensureAudioContext() {
  if (audioCtx) return audioCtx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  audioCtx = new Ctx();
  return audioCtx;
}

async function unlockAudio() {
  const ctx = ensureAudioContext();
  if (!ctx) return false;
  try {
    if (ctx.state === "suspended") await ctx.resume();
    // tiny silent beep to ensure output path is live
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0.00001;
    o.frequency.value = 440;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.01);
    audioUnlocked = true;
    return true;
  } catch {
    return false;
  }
}

function playChime({ when = "now", strength = 1 } = {}) {
  if (audioState.muted) return;
  if (!audioUnlocked) {
    el.btnEnableSound.hidden = false;
    return;
  }
  const ctx = ensureAudioContext();
  if (!ctx) return;

  const t0 = ctx.currentTime + 0.01;
  const vol = audioState.volume * (0.9 + 0.1 * clamp01(strength));

  // Soft bell-ish stack: sine fundamentals with quick attack + long decay.
  const freqs = [523.25, 659.25, 783.99]; // C5, E5, G5
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, t0);
  master.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), t0 + 0.02);
  master.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6);
  master.connect(ctx.destination);

  freqs.forEach((f, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(f, t0);
    const w = 1 - i * 0.18;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol * 0.6 * w), t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.25 + i * 0.18);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + 1.8);
  });
}

function setMuted(m) {
  audioState.muted = !!m;
  el.btnMute.textContent = audioState.muted ? "Sound: Off" : "Sound: On";
}

function setVolume(v) {
  audioState.volume = clamp01(v);
  el.volume.value = String(audioState.volume);
}

function canAutoplaySound() {
  // We attempt to unlock on first user gesture; until then show Enable.
  return audioUnlocked;
}

// ---------- State ----------

const cfg = getQuery();
setVolume(cfg.volume);
setMuted(!cfg.sound);
el.widgetTitle.textContent = cfg.title;
el.app.dataset.compact = cfg.compact ? "1" : "0";
document.documentElement.style.setProperty("--fontScale", String(cfg.fontScale));
document.documentElement.style.setProperty("--overlayOpacity", String(cfg.bgOpacity));
document.documentElement.style.setProperty("--bgBlur", `${cfg.bgBlurPx}px`);
if (cfg.hideTimeline) el.timeline.hidden = true;

const cacheKey = `schedule_cache::${cfg.src}`;
let schedule = { events: [], errors: [] };
let lastFetchAt = 0;
let lastGoodAt = 0;

// Local-only manual overrides (session)
const override = {
  forceNowMs: null, // number | null
};

function nowMs() {
  return override.forceNowMs ?? Date.now();
}

function loadCache() {
  try {
    const raw = localStorage.getItem(cacheKey);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.text !== "string") return false;
    schedule = parseNdjson(parsed.text);
    lastGoodAt = typeof parsed.savedAt === "number" ? parsed.savedAt : 0;
    return schedule.events.length > 0;
  } catch {
    return false;
  }
}

function saveCache(text) {
  try {
    localStorage.setItem(cacheKey, JSON.stringify({ text, savedAt: Date.now() }));
  } catch {
    // ignore quota errors
  }
}

async function fetchSchedule() {
  const t = Date.now();
  if (t - lastFetchAt < 1000) return; // avoid accidental double-fetch
  lastFetchAt = t;
  el.subTitle.textContent = "Refreshing schedule…";

  try {
    const resp = await fetch(cfg.src, { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    const parsed = parseNdjson(text);
    schedule = parsed;
    if (parsed.events.length > 0) {
      saveCache(text);
      lastGoodAt = Date.now();
    }
    return true;
  } catch (e) {
    el.subTitle.textContent = "Using cached schedule (fetch failed).";
    return false;
  }
}

function pickCurrentAndNext(events, now) {
  const currents = events.filter((ev) => ev.start.getTime() <= now && now < ev.end.getTime());
  currents.sort((a, b) => b.start - a.start); // most specific
  const current = currents[0] || null;
  const also = currents.slice(1);

  const next = events.find((ev) => ev.start.getTime() > now) || null;
  return { current, also, next };
}

function setRingProgress(progress01) {
  const p = clamp01(progress01);
  const circumference = 2 * Math.PI * 50; // r=50 matches svg
  const offset = circumference * (1 - p);
  const ring = document.querySelector(".ringValue");
  ring.style.strokeDasharray = `${circumference}`;
  ring.style.strokeDashoffset = `${offset}`;
}

function setBanner(text) {
  if (!text) {
    el.banner.hidden = true;
    el.banner.textContent = "";
    return;
  }
  el.banner.hidden = false;
  el.banner.textContent = text;
}

const warningState = {
  played: new Set(), // keys like "nextStart@5m@<epochSeconds>"
};

function boundariesCrossed(events, prevNow, now) {
  const out = [];
  for (const ev of events) {
    const s = ev.start.getTime();
    const e = ev.end.getTime();
    if (s > prevNow && s <= now) out.push({ t: s, kind: "start", ev });
    if (e > prevNow && e <= now) out.push({ t: e, kind: "end", ev });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

function maybeSetUpNextWarnings(next, now, refreshMs) {
  if (!next) {
    setBanner("");
    return;
  }
  const until = next.start.getTime() - now;
  const windows = [
    { mins: 5, label: "5 min" },
    { mins: 1, label: "1 min" },
  ];

  for (const w of windows) {
    const target = w.mins * 60 * 1000;
    const inWindow = until <= target && until > target - refreshMs - 250;
    if (!inWindow) continue;
    const key = `nextStart@${w.mins}m@${Math.floor(next.start.getTime() / 1000)}`;
    if (warningState.played.has(key)) continue;
    warningState.played.add(key);
    setBanner(`Up next in ${w.label}: ${next.title}`);
    return;
  }

  // Fallback banner when close
  setBanner(until <= 5 * 60000 && until > 0 ? `Next starts in ${formatDurationMs(until)}` : "");
}

function renderTimeline(events, now, tz) {
  const upcoming = events.filter((ev) => ev.end.getTime() > now).slice(0, 6);
  el.timelineList.innerHTML = "";
  if (upcoming.length === 0) {
    el.timelineHint.textContent = "No more events";
    return;
  }
  el.timelineHint.textContent = `${upcoming.length} shown`;

  for (const ev of upcoming) {
    const li = document.createElement("li");
    li.className = "tlItem";
    const left = document.createElement("div");
    left.className = "tlLeft";
    const title = document.createElement("div");
    title.className = "tlTitle";
    title.textContent = ev.title;
    const time = document.createElement("div");
    time.className = "tlTime";
    time.textContent = `${formatHhMm(ev.start, tz)}–${formatHhMm(ev.end, tz)}`;
    left.appendChild(title);
    left.appendChild(time);

    const right = document.createElement("div");
    right.className = "tlRight";
    if (ev.start.getTime() > now) {
      right.textContent = `in ${formatDurationMs(ev.start.getTime() - now)}`;
    } else {
      right.textContent = `ends in ${formatDurationMs(ev.end.getTime() - now)}`;
    }
    li.appendChild(left);
    li.appendChild(right);
    el.timelineList.appendChild(li);
  }
}

function setTheme(theme) {
  // Minimal: auto uses system. Dark-first design.
  // If you want light mode later, we can add a light token set.
  document.documentElement.dataset.theme = theme;
}

function maybeChimeAtBoundary(boundaryMs, kind) {
  // Dedup: play at most once per boundary second across overlaps.
  const sec = Math.floor(boundaryMs / 1000);
  if (audioState.lastChimeSecond === sec) return;
  audioState.lastChimeSecond = sec;
  playChime({ when: kind, strength: kind === "start" ? 1 : 0.9 });
}

function tick() {
  const now = nowMs();
  const events = schedule.events || [];
  const { current, also, next } = pickCurrentAndNext(events, now);
  const prev = tick.prevNow ?? now;

  if (schedule.errors?.length) {
    el.footLeft.textContent = `${schedule.errors.length} line(s) skipped`;
  } else {
    el.footLeft.textContent = "Schedule OK";
  }

  if (lastGoodAt) {
    el.footRight.textContent = `Updated ${new Date(lastGoodAt).toLocaleTimeString()}`;
  } else {
    el.footRight.textContent = "Not yet updated";
  }

  if (current) {
    const remaining = current.end.getTime() - now;
    el.taskTypePill.textContent = classifyTaskType(current.title).toUpperCase();
    el.currentTitle.textContent = current.title;
    el.bigTime.textContent = formatDurationMs(remaining);
    el.smallLabel.textContent = "time left";
    el.metaLine.textContent = `Ends at ${formatHhMm(current.end, cfg.tz)}`;

    const denom = current.end.getTime() - current.start.getTime();
    const prog = denom > 0 ? (now - current.start.getTime()) / denom : 0;
    setRingProgress(prog);

    // Accent + background by task type
    const type = classifyTaskType(current.title);
    document.documentElement.style.setProperty("--accent", accentFromColour(current.colour));
    document.documentElement.style.setProperty("--bgUrl", bgUrlForType(cfg, type));

    if (also.length) {
      el.alsoLine.hidden = false;
      el.alsoLine.textContent = `Also: ${also.map((x) => x.title).join(", ")}`;
    } else {
      el.alsoLine.hidden = true;
      el.alsoLine.textContent = "";
    }

    // Up-next banner (for next task)
    maybeSetUpNextWarnings(next, now, cfg.refreshMs);

    el.subTitle.textContent = next
      ? `Next: ${next.title} at ${formatHhMm(next.start, cfg.tz)}`
      : "No more tasks after this";
  } else if (next) {
    const until = next.start.getTime() - now;
    el.taskTypePill.textContent = "GAP";
    el.currentTitle.textContent = "No current task";
    el.bigTime.textContent = formatDurationMs(until);
    el.smallLabel.textContent = "until next";
    el.metaLine.textContent = `Next: ${next.title} at ${formatHhMm(next.start, cfg.tz)}`;
    setRingProgress(0);

    // Background based on upcoming task type
    const type = classifyTaskType(next.title);
    document.documentElement.style.setProperty("--accent", accentFromColour(next.colour));
    document.documentElement.style.setProperty("--bgUrl", bgUrlForType(cfg, type));
    el.alsoLine.hidden = true;
    maybeSetUpNextWarnings(next, now, cfg.refreshMs);

    el.subTitle.textContent = "Between schedule blocks";
  } else {
    el.taskTypePill.textContent = "DONE";
    el.currentTitle.textContent = "No more tasks today";
    el.bigTime.textContent = "--:--";
    el.smallLabel.textContent = "finished";
    el.metaLine.textContent = "Enjoy the rest of your day";
    setRingProgress(0);
    setBanner("");
    el.alsoLine.hidden = true;
    el.subTitle.textContent = "Schedule complete";
    document.documentElement.style.setProperty("--bgUrl", "none");
  }

  // Chimes: evaluate all boundaries crossed between prev and now.
  if (cfg.notify && !audioState.muted) {
    const crossed = boundariesCrossed(events, prev, now);
    for (const b of crossed) {
      maybeChimeAtBoundary(b.t, b.kind);
    }
  }

  if (!cfg.hideTimeline) renderTimeline(events, now, cfg.tz);
  tick.prevNow = now;
}

// ---------- UI wiring ----------

setTheme(cfg.theme);

el.btnEnableSound.addEventListener("click", async () => {
  const ok = await unlockAudio();
  if (ok) {
    el.btnEnableSound.hidden = true;
    playChime({ strength: 1 });
  }
});

el.btnTestChime.addEventListener("click", async () => {
  if (!audioUnlocked) {
    const ok = await unlockAudio();
    if (!ok) {
      el.btnEnableSound.hidden = false;
      return;
    }
    el.btnEnableSound.hidden = true;
  }
  playChime({ strength: 1 });
});

el.btnMute.addEventListener("click", () => {
  setMuted(!audioState.muted);
});

el.volume.addEventListener("input", () => {
  setVolume(Number(el.volume.value));
});

el.btnSkipNext.addEventListener("click", () => {
  const now = nowMs();
  const next = schedule.events.find((ev) => ev.start.getTime() > now);
  if (!next) return;
  override.forceNowMs = next.start.getTime();
  setTimeout(() => {
    override.forceNowMs = null;
  }, 1500);
  maybeChimeAtBoundary(next.start.getTime(), "start");
});

el.btnEndEarly.addEventListener("click", () => {
  const now = nowMs();
  const current = schedule.events
    .filter((ev) => ev.start.getTime() <= now && now < ev.end.getTime())
    .sort((a, b) => b.start - a.start)[0];
  if (!current) return;
  override.forceNowMs = current.end.getTime();
  setTimeout(() => {
    override.forceNowMs = null;
  }, 1500);
  maybeChimeAtBoundary(current.end.getTime(), "end");
});

// Try to load cache immediately for fast paint.
loadCache();

// Initial render
tick();

// Start ticking
setInterval(tick, cfg.refreshMs);

// Periodic re-fetch
fetchSchedule().then(() => tick());
setInterval(() => {
  fetchSchedule().then(() => tick());
}, cfg.fetchEveryMs);

// Autoplay policies: show enable button if sound is on but locked.
if (!audioState.muted && !canAutoplaySound()) {
  el.btnEnableSound.hidden = false;
}

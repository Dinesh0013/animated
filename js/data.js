// Data layer: loads the same read-only Apps Script feed as the dashboard and
// applies the same cleaning rules (viewer counts, names, usable locations).

export const DATA_URL =
  "https://script.google.com/macros/s/AKfycbzJJIagM6mqa-6wSObRiYWTFlN4i_Jt1lQgNIlyBrsVzPyLAr9tGVmJuBAFCgc-kAx-wQ/exec";
export const VIEWERS_KEY = "Number of individuals who watched the video";

const CACHE_KEY = "videoReachData";
const FETCH_TIMEOUT_MS = 15000;
const MAX_PLAUSIBLE_VIEWERS = 20000;
const WORD_NUMBERS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

// Delhi and its immediate surroundings (used to decide which schools belong to the Delhi chapter).
export const DELHI_BOUNDS = { south: 28.4, north: 28.9, west: 76.8, east: 77.4 };

export const formatNumber = (n) => new Intl.NumberFormat("en-GB").format(n);
export const monthShort = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" });
export const monthLong = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });
export const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/* ---------- Loading and caching ---------- */

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY));
  } catch (e) {
    return null;
  }
}

function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch (e) {
    // Storage can be unavailable (private mode); the cache is optional.
  }
}

// The deployed feed can return column names with stray spaces; trim them so lookups are reliable.
function trimKeys(rows) {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim(), value])));
}

export async function fetchLive() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(DATA_URL, { signal: controller.signal });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error("Unexpected data format");
    const rows = trimKeys(data);
    writeCache(rows);
    return rows;
  } finally {
    clearTimeout(timer);
  }
}

// Live data first; fall back to the last good copy. Returns { data, stale }.
export async function loadData() {
  try {
    return { data: await fetchLive(), stale: false };
  } catch (err) {
    console.error("Could not load live data:", err);
    const cached = readCache();
    if (Array.isArray(cached)) return { data: trimKeys(cached), stale: true };
    return { data: null, stale: false };
  }
}

/* ---------- Cleaning ---------- */

// Accepts numbers, "400", "Approx 400", "Trisha 1" and "ONE"; anything absurd counts as 0.
export function parseViewers(value) {
  let count = 0;
  if (typeof value === "number") {
    count = value;
  } else {
    const text = String(value || "").trim().toLowerCase();
    const digits = text.match(/\d[\d,]*/);
    if (digits) {
      count = parseInt(digits[0].replace(/,/g, ""), 10);
    } else {
      const word = text.split(/\s+/).find((w) => w in WORD_NUMBERS);
      count = word ? WORD_NUMBERS[word] : 0;
    }
  }
  if (!Number.isFinite(count) || count < 0 || count > MAX_PLAUSIBLE_VIEWERS) {
    console.warn("Ignoring implausible viewer count:", value);
    return 0;
  }
  return count;
}

// True when the form gave a usable number (or an explicit 0), false for blanks and rejected values.
export function viewersReported(raw, count) {
  return count > 0 || String(raw).trim() === "0";
}

// Only reformat all-caps or all-lowercase text; mixed case is assumed to be intentional.
function titleCase(text) {
  if (text !== text.toUpperCase() && text !== text.toLowerCase()) return text;
  return text.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function looksLikeAddress(text) {
  return (text.match(/,/g) || []).length >= 2 || /\b\d{6}\b/.test(text);
}

// Fixes swapped name/address and replaces generic names with the address.
export function displayName(row) {
  let name = String(row["Name of the Organisation"] || "").trim();
  const address = String(row["Address of the Organization/Viewer"] || row["Address"] || "").trim();
  let place = address;

  if (name && place && looksLikeAddress(name) && !looksLikeAddress(place)) {
    [name, place] = [place, name];
  }
  if (!name || /^kendriya vidyalaya( sangathan)?$/i.test(name)) {
    if (!place) return "Unnamed organisation";
    const base = titleCase(place);
    return /vidyalaya|\bk\.? ?v\b/i.test(place) ? base : "Kendriya Vidyalaya " + base;
  }
  return name;
}

// Skips rows whose geocode failed or only resolved to a country/state-level match.
export function hasUsableLocation(row, lat, lng) {
  if (Number.isNaN(lat) || Number.isNaN(lng)) return false;
  return String(row["geocode_quality"] || "").toUpperCase() !== "VAGUE";
}

// The feed sends ISO strings; sheet-style "M/D/YYYY H:mm" text is also accepted.
export function parseTimestamp(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") return new Date(value);
  const text = String(value || "").trim();
  if (!text) return null;
  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  const date = us
    ? new Date(+us[3], +us[1] - 1, +us[2], +(us[4] || 0), +(us[5] || 0))
    : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/* ---------- Derived data ---------- */

// One clean record per submission.
export function toSchools(data) {
  return data.map((row) => {
    const raw = row[VIEWERS_KEY];
    const students = parseViewers(raw);
    const lat = parseFloat(row["lat"]);
    const lng = parseFloat(row["lng"]);
    return {
      name: displayName(row),
      students,
      reported: viewersReported(raw, students),
      date: parseTimestamp(row["Timestamp"]),
      lat,
      lng,
      mappable: hasUsableLocation(row, lat, lng)
    };
  }).map((school) => ({ ...school, delhi: inDelhi(school) }));
}

export function inDelhi(school) {
  return (
    school.mappable &&
    school.lat >= DELHI_BOUNDS.south && school.lat <= DELHI_BOUNDS.north &&
    school.lng >= DELHI_BOUNDS.west && school.lng <= DELHI_BOUNDS.east
  );
}

// One entry per calendar month from the first submission to the current month, gaps included.
export function buildMonthlySeries(schools, now = new Date()) {
  const months = new Map();
  let first = Infinity;

  schools.forEach((school) => {
    if (!school.date) return;
    const index = school.date.getFullYear() * 12 + school.date.getMonth();
    const entry = months.get(index) || { students: 0, schools: 0 };
    entry.students += school.students;
    entry.schools += 1;
    months.set(index, entry);
    first = Math.min(first, index);
  });

  if (!months.size) return [];

  const last = Math.max(now.getFullYear() * 12 + now.getMonth(), ...months.keys());
  const series = [];
  let total = 0;
  for (let index = first; index <= last; index++) {
    const entry = months.get(index) || { students: 0, schools: 0 };
    const previousTotal = total;
    total += entry.students;
    series.push({
      date: new Date(Math.floor(index / 12), index % 12, 1),
      added: entry.students,
      schools: entry.schools,
      total,
      growth: previousTotal > 0 ? (entry.students / previousTotal) * 100 : null
    });
  }
  return series;
}

export function formatGrowth(growth) {
  if (growth === null) return "–";
  return (growth > 0 ? "+" : "") + growth.toFixed(1) + "%";
}

// Everything the story and sections need, computed once per data refresh.
export function buildModel(data) {
  const schools = toSchools(data);
  const series = buildMonthlySeries(schools);
  const delhi = schools.filter(inDelhi);

  const totalStudents = schools.reduce((sum, s) => sum + s.students, 0);
  const delhiStudents = delhi.reduce((sum, s) => sum + s.students, 0);
  const byReach = [...delhi].filter((s) => s.reported).sort((a, b) => b.students - a.students);
  const byDate = [...schools].filter((s) => s.date).sort((a, b) => b.date - a.date);

  return {
    schools,
    series,
    delhi,
    totalSchools: schools.length,
    totalStudents,
    delhiSchools: delhi.length,
    delhiStudents,
    topDelhi: byReach.slice(0, 5),
    newest: byDate[0] || null,
    latestMonth: series[series.length - 1] || null,
    firstMonth: series[0] || null
  };
}

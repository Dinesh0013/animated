// Everything outside the map: chapter copy, KPIs, the monthly growth chart and table,
// the Schools tab, the bubble chart and the India-outline motif. All of it is rebuilt
// from the data model on every refresh.

import {
  formatNumber, formatGrowth, monthShort, monthLong, dayFormat
} from "./data.js";

const COLORS = {
  green: "#1f7a5a",
  greenSoft: "rgba(31, 122, 90, 0.14)",
  ink: "#0d2226",
  muted: "#66797a",
  grid: "#ded8c8"
};

const MIN_BUBBLE_UNITS = 0.16;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let growthChart = null;
let bubbleChart = null;
let bubbleItems = [];
let latestSeries = [];

const $ = (id) => document.getElementById(id);
const setText = (id, text) => { const el = $(id); if (el) el.textContent = text; };

/* ---------- Counting animation ---------- */

export function setNumber(el, target) {
  if (!el) return;
  const from = Number(el.dataset.value || 0);
  el.dataset.value = target;
  cancelAnimationFrame(el._frame);
  if (reduceMotion.matches || from === target) {
    el.textContent = formatNumber(target);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const progress = Math.min((now - start) / 1000, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = formatNumber(Math.round(from + (target - from) * eased));
    if (progress < 1) el._frame = requestAnimationFrame(step);
  };
  el._frame = requestAnimationFrame(step);
}

/* ---------- Story copy and key figures ---------- */

export function renderStoryText(model) {
  const { totalSchools, totalStudents, delhiSchools, delhiStudents, latestMonth, firstMonth, newest, topDelhi } = model;
  const schoolWord = (n) => (n === 1 ? "school" : "schools");

  setText("c1Title", `One video. ${formatNumber(totalSchools)} ${schoolWord(totalSchools)}. ${formatNumber(totalStudents)} students.`);
  setNumber($("kSchools"), totalSchools);
  setNumber($("kStudents"), totalStudents);
  setText("kSince", firstMonth ? monthShort.format(firstMonth.date) : "–");

  if (delhiSchools === 0) {
    setText("c2Title", "Waiting for the first schools");
    setText("c2Body", "No schools with a usable location have been added yet. They appear on the map as soon as they join.");
  } else if (delhiSchools === totalSchools) {
    setText("c2Title", "Delhi, school by school");
    setText("c2Body", `All ${formatNumber(totalSchools)} participating ${schoolWord(totalSchools)} so far are in Delhi, together reaching ${formatNumber(delhiStudents)} students.`);
  } else {
    setText("c2Title", "Delhi, school by school");
    setText("c2Body", `${formatNumber(delhiSchools)} of the ${formatNumber(totalSchools)} participating schools are in Delhi, reaching ${formatNumber(delhiStudents)} students.`);
  }

  setText("c3Newest", newest
    ? `Newest school: ${newest.name}, added ${dayFormat.format(newest.date)}.`
    : "");

  const list = $("topList");
  list.textContent = "";
  topDelhi.forEach((school) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    const name = document.createElement("span");
    name.textContent = school.name;
    const count = document.createElement("strong");
    count.textContent = formatNumber(school.students);
    button.append(name, count);
    button.dataset.key = `${school.lat},${school.lng},${school.name}`;
    item.append(button);
    list.append(item);
  });
  $("topListWrap").hidden = topDelhi.length === 0;

  const month = latestMonth ? monthLong.format(latestMonth.date) : "";
  const since = firstMonth ? monthLong.format(firstMonth.date) : "";
  const added = latestMonth && latestMonth.added > 0
    ? ` ${formatNumber(latestMonth.added)} students were added in ${month}.`
    : "";
  setText("c4Body", `${formatNumber(totalStudents)} students across ${formatNumber(totalSchools)} ${schoolWord(totalSchools)} since ${since}.${added}`);

  // Video section facts
  setText("vSince", firstMonth ? monthLong.format(firstMonth.date) : "–");
  setText("vMonths", firstMonth ? String(model.series.length) : "–");
  setText("vAddedLabel", latestMonth ? `Added in ${monthShort.format(latestMonth.date)}` : "Added this month");
  setNumber($("vAdded"), latestMonth ? latestMonth.added : 0);
  setText("vAddedNote", latestMonth && latestMonth.growth !== null ? `${formatGrowth(latestMonth.growth)} on the previous total` : "");
}

/* ---------- Monthly growth ---------- */

function renderGrowthTable(series) {
  const body = $("growthRows");
  body.textContent = "";
  series.forEach((item) => {
    const row = document.createElement("tr");
    [
      monthLong.format(item.date),
      formatNumber(item.schools),
      formatNumber(item.added),
      formatNumber(item.total),
      formatGrowth(item.growth)
    ].forEach((text, index) => {
      const cell = document.createElement("td");
      cell.textContent = text;
      if (index === 4 && item.growth > 0) cell.className = "positive";
      row.appendChild(cell);
    });
    body.appendChild(row);
  });
}

function renderGrowthStats(series) {
  const latest = series[series.length - 1];
  const peak = series.reduce((best, item) => (item.added > best.added ? item : best), series[0]);
  setText("gsTotal", formatNumber(latest.total));
  setText("gsLatestLabel", `Added in ${monthShort.format(latest.date)}`);
  setText("gsLatest", `+${formatNumber(latest.added)}`);
  setText("gsPeak", peak.added > 0 ? `${monthShort.format(peak.date)} (+${formatNumber(peak.added)})` : "–");
}

function renderGrowth(series) {
  latestSeries = series;
  const empty = !series.length;
  $("growthEmpty").hidden = !empty;
  $("growthContent").hidden = empty;
  if (empty) return;

  renderGrowthStats(series);
  renderGrowthTable(series);

  const labels = series.map((item) => monthShort.format(item.date));
  const totals = series.map((item) => item.total);
  const latest = series[series.length - 1];
  $("growthChart").setAttribute(
    "aria-label",
    `Chart of the running total of students who watched the video, from ${labels[0]} to ${labels[labels.length - 1]}. The running total reaches ${formatNumber(latest.total)} students.`
  );

  if (growthChart) {
    growthChart.data.labels = labels;
    growthChart.data.datasets[0].data = totals;
    growthChart.update();
    return;
  }

  growthChart = new Chart($("growthChart").getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Running total",
        data: totals,
        borderColor: COLORS.green,
        backgroundColor: COLORS.greenSoft,
        fill: true,
        tension: 0.25,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: "#ffffff",
        pointBorderColor: COLORS.green,
        pointBorderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: reduceMotion.matches ? false : { duration: 700 },
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { grid: { display: false }, ticks: { color: COLORS.muted, maxRotation: 0, autoSkip: true } },
        y: {
          beginAtZero: true,
          grid: { color: COLORS.grid },
          border: { display: false },
          ticks: { color: COLORS.muted, callback: (value) => formatNumber(value) },
          title: { display: true, text: "Students", color: COLORS.muted }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => monthLong.format(latestSeries[items[0].dataIndex].date),
            label: (ctx) => ` ${ctx.dataset.label}: ${formatNumber(ctx.parsed.y)}`,
            footer: (items) => {
              const item = latestSeries[items[0].dataIndex];
              return `Students added: ${formatNumber(item.added)}\nSchools added: ${formatNumber(item.schools)}\nGrowth on previous total: ${formatGrowth(item.growth)}`;
            }
          }
        }
      }
    }
  });
}

/* ---------- Schools tab ---------- */

function renderSchools(model) {
  const time = (date) => (date ? date.getTime() : 0);
  const schools = [...model.schools].sort((a, b) => time(b.date) - time(a.date));

  setText("schoolsMeta", `${formatNumber(schools.length)} ${schools.length === 1 ? "school" : "schools"} and ${formatNumber(model.totalStudents)} students, newest first.`);

  const body = $("schoolRows");
  body.textContent = "";
  schools.forEach((school) => {
    const row = document.createElement("tr");
    [
      { text: school.name, className: "wrap-text" },
      { text: school.date ? dayFormat.format(school.date) : "–" },
      school.reported
        ? { text: formatNumber(school.students) }
        : { text: "Not reported", className: "muted" }
    ].forEach(({ text, className }) => {
      const cell = document.createElement("td");
      cell.textContent = text;
      if (className) cell.className = className;
      row.appendChild(cell);
    });
    body.appendChild(row);
  });
}

export function initTabs() {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const select = (tab) => {
    tabs.forEach((item) => {
      const active = item === tab;
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
      $(item.getAttribute("aria-controls")).hidden = !active;
    });
    if (growthChart) growthChart.resize();
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (event) => {
      const last = tabs.length - 1;
      const target = {
        ArrowRight: index === last ? 0 : index + 1,
        ArrowLeft: index === 0 ? last : index - 1,
        Home: 0,
        End: last
      }[event.key];
      if (target === undefined) return;
      event.preventDefault();
      tabs[target].focus();
      select(tabs[target]);
    });
  });
}

/* ---------- School bubbles ---------- */

// Greedy spiral packing: each circle goes to the first free spot nearest the centre.
function packCircles(radii, gap = 0.06) {
  const order = radii.map((r, i) => i).sort((a, b) => radii[b] - radii[a]);
  const spots = new Array(radii.length);
  const placed = [];
  order.forEach((i) => {
    let angle = 0;
    let distance = 0;
    while (placed.length) {
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance;
      const free = placed.every((j) => Math.hypot(x - spots[j].x, y - spots[j].y) >= radii[i] + radii[j] + gap);
      if (free) {
        spots[i] = { x, y };
        break;
      }
      angle += 0.5;
      distance += 0.012;
    }
    if (!spots[i]) spots[i] = { x: 0, y: 0 };
    placed.push(i);
  });
  return spots;
}

// Area is proportional to students, so radius follows the square root.
function buildBubbleItems(schools) {
  const items = schools.map((school) => ({ ...school }));
  const maxStudents = Math.max(1, ...items.map((item) => item.students));
  items.forEach((item) => {
    item.ru = Math.max(MIN_BUBBLE_UNITS, Math.sqrt(item.students / maxStudents));
  });
  const spots = packCircles(items.map((item) => item.ru));
  items.forEach((item, index) => {
    item.ux = spots[index].x;
    item.uy = spots[index].y;
  });
  return items;
}

// Fits the packed layout to the canvas; called on data changes and on every resize.
function layoutBubbles(width, height) {
  if (!bubbleChart || !bubbleItems.length || !width || !height) return;

  const box = (stretch) => bubbleItems.reduce((b, item) => ({
    minX: Math.min(b.minX, item.ux * stretch - item.ru),
    maxX: Math.max(b.maxX, item.ux * stretch + item.ru),
    minY: Math.min(b.minY, item.uy - item.ru),
    maxY: Math.max(b.maxY, item.uy + item.ru)
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });

  // Spread horizontally on wide canvases; stretching only increases gaps, so bubbles never overlap.
  const base = box(1);
  const wanted = (width / height) / ((base.maxX - base.minX) / (base.maxY - base.minY));
  const stretch = Math.min(Math.max(wanted, 1), 4);
  const b = box(stretch);

  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const boxWidth = b.maxX - b.minX;
  const boxHeight = b.maxY - b.minY;
  const maxRadius = Math.max(...bubbleItems.map((item) => item.ru));

  const dataset = bubbleChart.data.datasets[0];
  dataset.backgroundColor = bubbleItems.map((item) => (item.reported ? "rgba(31, 122, 90, 0.62)" : "rgba(102, 121, 122, 0.45)"));
  dataset.borderColor = bubbleItems.map((item) => (item.reported ? COLORS.green : "#66797a"));
  dataset.hoverBackgroundColor = bubbleItems.map((item) => (item.reported ? "rgba(31, 122, 90, 0.92)" : "rgba(102, 121, 122, 0.8)"));

  // Chart.js insets the plot area by roughly the largest bubble radius, so measure that inset
  // once, then solve for the pixels-per-unit that fits the layout exactly.
  const draw = (k, areaWidth, areaHeight) => {
    dataset.data = bubbleItems.map((item) => ({
      x: item.ux * stretch,
      y: item.uy,
      r: item.ru * k,
      name: item.name,
      students: item.students,
      reported: item.reported,
      date: item.date
    }));
    const scales = bubbleChart.options.scales;
    scales.x.min = cx - areaWidth / (2 * k);
    scales.x.max = cx + areaWidth / (2 * k);
    scales.y.min = cy - areaHeight / (2 * k);
    scales.y.max = cy + areaHeight / (2 * k);
    bubbleChart.update("none");
    const area = bubbleChart.chartArea;
    return { width: area.right - area.left, height: area.bottom - area.top, inset: area.left };
  };

  const pad = 8;
  const probeK = 10;
  const probe = draw(probeK, width, height);
  const insetFactor = probe.inset / (maxRadius * probeK);
  const k = Math.min(
    (width - 2 * pad) / (boxWidth + 2 * insetFactor * maxRadius),
    (height - 2 * pad) / (boxHeight + 2 * insetFactor * maxRadius)
  );
  const fitted = draw(k, width, height);
  draw(k, fitted.width, fitted.height);
}

function renderBubbles(schools) {
  const empty = !schools.length;
  $("bubbleEmpty").hidden = !empty;
  $("bubbleBox").hidden = empty;
  bubbleItems = empty ? [] : buildBubbleItems(schools);
  if (empty) return;

  if (!bubbleChart) {
    bubbleChart = new Chart($("bubbleChart").getContext("2d"), {
      type: "bubble",
      data: {
        datasets: [{ label: "Schools", data: [], borderWidth: 1.5, hoverBorderWidth: 3, hoverRadius: 4 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reduceMotion.matches ? false : { duration: 400 },
        layout: { padding: 0 },
        onResize: (chart, size) => layoutBubbles(size.width, size.height),
        scales: {
          x: { display: false, grid: { display: false } },
          y: { display: false, grid: { display: false } }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              title: (items) => items[0].raw.name,
              label: (ctx) => (ctx.raw.reported
                ? `${formatNumber(ctx.raw.students)} ${ctx.raw.students === 1 ? "student" : "students"}`
                : "Student count not reported"),
              afterLabel: (ctx) => (ctx.raw.date ? `Added ${dayFormat.format(ctx.raw.date)}` : "")
            }
          }
        }
      }
    });
  }
  layoutBubbles(bubbleChart.width, bubbleChart.height);
}

/* ---------- India-outline motif ---------- */

// Draws the state boundaries as a quiet SVG that recurs through the page.
export function buildMotif(geojson) {
  const lat0 = 22 * Math.PI / 180;
  const minLng = 68;
  const maxLat = 37.2;
  const project = ([lng, lat]) => [(lng - minLng) * Math.cos(lat0) * 40, (maxLat - lat) * 40];

  const parts = [];
  const ring = (coords) => {
    parts.push(coords.map((c, i) => {
      const [x, y] = project(c);
      return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join("") + "Z");
  };
  geojson.features.forEach(({ geometry }) => {
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    polygons.forEach((polygon) => polygon.forEach(ring));
  });

  const width = (97.6 - minLng) * Math.cos(lat0) * 40;
  const height = (maxLat - 6.5) * 40;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width.toFixed(0)} ${height.toFixed(0)}`);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", parts.join(""));
  path.setAttribute("vector-effect", "non-scaling-stroke");
  svg.appendChild(path);
  return svg;
}

/* ---------- Entry point ---------- */

export function renderSections(model) {
  renderGrowth(model.series);
  renderSchools(model);
  renderBubbles(model.schools);
}

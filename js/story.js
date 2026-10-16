// Scroll-driven map story: a pinned full-screen MapLibre map whose camera is a pure
// function of scroll progress (India -> Delhi -> India), plus the school markers and
// the chapter panels that fade in and out along the way.

import { formatNumber, dayFormat } from "./data.js";

const INDIA_BOUNDS = [[68.1, 6.7], [97.4, 37.1]];
const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const STATES_URL = new URL("../data/india-states.geojson", import.meta.url).href;
const DELHI_URL = new URL("../data/delhi.geojson", import.meta.url).href;
const DISTRICTS_URL = new URL("../data/india-districts.geojson", import.meta.url).href;

// Scroll progress (0..1) at which each camera phase starts and ends.
// Progress range over which the school list scrolls from its first to its last name.
const LIST_SCROLL = { from: 0.45, to: 0.58 };

const PHASE = { holdIndia: 0.07, arriveDelhi: 0.36, leaveDelhi: 0.62, backInIndia: 0.9 };

const LATIN_NAME = ["coalesce", ["get", "name_en"], ["get", "name:latin"], ["get", "name"]];

const PALETTE = {
  land: "#0d2d33",
  water: "#061a1f",
  india: "#164a52",
  indiaEdge: "#3b7f86",
  green: "#5fc197"
};

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (x) => x * x * (3 - 2 * x);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

/* ---------- Map style ---------- */

// Recolours OpenFreeMap's light style into the midnight-teal palette and adds the
// India state boundaries, the Delhi outline and state names.
function buildStyle(base) {
  const style = JSON.parse(JSON.stringify(base));
  const labelFont = (style.layers.find((l) => l.id === "label_state") || {}).layout?.["text-font"] || ["Noto Sans Regular"];

  const text = (layer, color, halo = PALETTE.water) => {
    layer.paint["text-color"] = color;
    layer.paint["text-halo-color"] = halo;
    layer.paint["text-halo-width"] = 1.3;
    layer.paint["text-halo-blur"] = 0.4;
  };

  style.layers.forEach((layer) => {
    const id = layer.id;
    layer.paint = layer.paint || {};
    layer.layout = layer.layout || {};

    if (/^boundary/.test(id) || /shield/.test(id) || id === "label_state") {
      layer.layout.visibility = "none";
      return;
    }
    if (id === "background") layer.paint["background-color"] = PALETTE.land;
    else if (id === "water") layer.paint["fill-color"] = PALETTE.water;
    else if (id === "park") { layer.paint["fill-color"] = "#12383d"; layer.paint["fill-opacity"] = 0.7; }
    else if (/^landcover/.test(id)) { layer.paint["fill-color"] = "#14373d"; layer.paint["fill-opacity"] = 0.35; }
    else if (id === "landuse_residential") { layer.paint["fill-color"] = "#12363c"; layer.paint["fill-opacity"] = 0.6; }
    else if (id === "building") { layer.paint["fill-color"] = "#1d4c52"; layer.paint["fill-outline-color"] = "#2b6169"; }
    else if (id === "waterway") layer.paint["line-color"] = "#0b2c33";
    else if (/^aeroway-area|pier/.test(id) && layer.type === "fill") layer.paint["fill-color"] = "#143a40";
    else if (layer.type === "line") {
      if (/casing/.test(id)) { layer.paint["line-color"] = "#051519"; layer.paint["line-opacity"] = 0.9; }
      else if (/motorway|major/.test(id)) layer.paint["line-color"] = "#42888d";
      else if (/railway/.test(id)) layer.paint["line-color"] = "#2a5a60";
      else layer.paint["line-color"] = "#2d666d";
      // Roads stay quiet at country scale and sharpen as the camera closes in.
      if (!/casing/.test(id)) layer.paint["line-opacity"] = ["interpolate", ["linear"], ["zoom"], 5, 0.3, 9, 0.9];
    } else if (layer.type === "symbol") {
      // English names only, so labels stay readable for every visitor.
      if (layer.layout["text-field"]) layer.layout["text-field"] = LATIN_NAME;
      if (/^label_country/.test(id)) text(layer, "#8fb0a8");
      else if (/^label_city/.test(id)) text(layer, "#e3eadf");
      else if (/^label_(town|village|other)/.test(id)) text(layer, "#9dbab1");
      else if (/water/.test(id)) text(layer, "#4f858b");
      else text(layer, "#7fa39b");
    }
  });

  style.sources.india = { type: "geojson", data: STATES_URL };
  style.sources.delhi = { type: "geojson", data: DELHI_URL };
  style.sources.districts = { type: "geojson", data: DISTRICTS_URL };

  const backgroundIndex = style.layers.findIndex((l) => l.id === "background");
  style.layers.splice(backgroundIndex + 1, 0,
    {
      id: "india-fill",
      type: "fill",
      source: "india",
      paint: { "fill-color": PALETTE.india }
    },
    {
      id: "india-districts",
      type: "line",
      source: "districts",
      layout: { "line-join": "round" },
      paint: {
        "line-color": "#2c6a71",
        "line-width": 0.6,
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 4.6, 0, 6.5, 0.5, 11, 0.3]
      }
    },
    {
      id: "india-borders",
      type: "line",
      source: "india",
      layout: { "line-join": "round" },
      paint: {
        "line-color": PALETTE.indiaEdge,
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 8, 1.4, 12, 2],
        "line-opacity": 0.9
      }
    },
    {
      id: "delhi-fill",
      type: "fill",
      source: "delhi",
      paint: {
        "fill-color": PALETTE.green,
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0, 8, 0.1]
      }
    },
    {
      id: "delhi-line",
      type: "line",
      source: "delhi",
      layout: { "line-join": "round" },
      paint: {
        "line-color": PALETTE.green,
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.6, 10, 1.8],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.2, 8, 0.85],
        "line-dasharray": [2, 2]
      }
    }
  );

  style.layers.push({
    id: "india-state-names",
    type: "symbol",
    source: "india",
    minzoom: 3.2,
    maxzoom: 7.6,
    layout: {
      "text-field": ["get", "name"],
      "text-font": labelFont,
      "text-size": ["interpolate", ["linear"], ["zoom"], 3.2, 9, 7, 13],
      "text-letter-spacing": 0.04,
      "text-max-width": 7
    },
    paint: {
      "text-color": "#a9c8bf",
      "text-halo-color": PALETTE.india,
      "text-halo-width": 1.2,
      "text-opacity": ["interpolate", ["linear"], ["zoom"], 5.6, 1, 7.6, 0]
    }
  });

  return style;
}

/* ---------- Story ---------- */

export async function createStory({ storyEl, mapEl, onStatus }) {
  if (!window.maplibregl || !window.gsap || !window.ScrollTrigger) {
    throw new Error("Map libraries did not load");
  }
  gsap.registerPlugin(ScrollTrigger);

  const base = await (await fetch(STYLE_URL)).json();
  const map = new maplibregl.Map({
    container: mapEl,
    style: buildStyle(base),
    center: [80.5, 22.5],
    zoom: 3.6,
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
    renderWorldCopies: false,
    maxPitch: 60,
    maxZoom: 13
  });
  map.addControl(new maplibregl.AttributionControl({
    compact: true,
    customAttribution: "India boundaries: udit-001/india-maps-data"
  }), "bottom-right");

  await new Promise((resolve, reject) => {
    map.once("load", resolve);
    map.once("error", (e) => { if (!map.loaded()) reject(e.error || e); });
  });

  const chapters = Array.from(storyEl.querySelectorAll(".chapter")).map((el) => ({
    el,
    range: el.dataset.show.split(/\s+/).map(Number),
    shift: el.dataset.shift || "up"
  }));
  const listEl = storyEl.querySelector("#schoolList");
  const navDots = Array.from(storyEl.querySelectorAll(".chapter-nav button"));
  const cue = storyEl.querySelector(".scroll-cue");

  let cameras = null;
  let schools = [];
  let markers = [];
  let progress = 0;
  let lastKey = "";
  let revealed = false;
  let popup = null;
  let pinned = null;
  let tween = null;

  /* Cameras */

  function toCamera(options, bounds) {
    const cam = map.cameraForBounds(bounds, options);
    return { center: [cam.center.lng, cam.center.lat], zoom: cam.zoom };
  }

  function computeCameras() {
    const { clientWidth: w, clientHeight: h } = mapEl;
    const mobile = w < 760;

    const india = toCamera({
      padding: mobile
        ? { top: 70, bottom: Math.round(h * 0.4), left: 10, right: 10 }
        : { top: 76, bottom: 34, left: Math.min(Math.round(w * 0.3), 460), right: 24 }
    }, INDIA_BOUNDS);

    // Frame the real school locations; fall back to Delhi's extent if there are none.
    const spots = schools.filter((s) => s.delhi);
    const lngs = spots.map((s) => s.lng);
    const lats = spots.map((s) => s.lat);
    const bounds = spots.length
      ? [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]]
      : [[76.95, 28.45], [77.35, 28.85]];

    const arrive = toCamera({
      padding: mobile
        ? { top: 90, bottom: Math.round(h * 0.5), left: 28, right: 28 }
        : { top: 100, bottom: 90, left: Math.min(Math.round(w * 0.4), 580), right: 110 },
      maxZoom: 11.4
    }, bounds);

    const still = reduceMotion.matches;
    const d1 = { ...arrive, pitch: still ? 0 : 26, bearing: still ? 0 : -12 };
    const d2 = {
      center: [arrive.center[0] + 0.05, arrive.center[1] - 0.025],
      zoom: arrive.zoom + (still ? 0 : 0.35),
      pitch: still ? 0 : 32,
      bearing: still ? 0 : -4
    };
    cameras = { india: { ...india, pitch: 0, bearing: 0 }, d1, d2 };
  }

  function mix(a, b, panT, zoomT) {
    return {
      center: [lerp(a.center[0], b.center[0], panT), lerp(a.center[1], b.center[1], panT)],
      zoom: lerp(a.zoom, b.zoom, zoomT),
      pitch: lerp(a.pitch, b.pitch, zoomT),
      bearing: lerp(a.bearing, b.bearing, zoomT)
    };
  }

  // The camera is a pure function of progress, so scrolling either way retraces the same path.
  function cameraAt(p) {
    const { india, d1, d2 } = cameras;
    const still = reduceMotion.matches;

    if (p <= PHASE.holdIndia || p >= PHASE.backInIndia) return { ...india, zoomT: 0 };

    if (p < PHASE.arriveDelhi) {
      const t = (p - PHASE.holdIndia) / (PHASE.arriveDelhi - PHASE.holdIndia);
      if (still) return { ...(t < 0.5 ? india : d1), zoomT: t < 0.5 ? 0 : 1 };
      return { ...mix(india, d1, easeInOutSine(t), easeInOutCubic(t)), zoomT: easeInOutCubic(t) };
    }
    if (p <= PHASE.leaveDelhi) {
      const t = (p - PHASE.arriveDelhi) / (PHASE.leaveDelhi - PHASE.arriveDelhi);
      const e = still ? 0 : easeInOutSine(t);
      return { ...mix(d1, d2, e, e), zoomT: 1 };
    }
    const t = (p - PHASE.leaveDelhi) / (PHASE.backInIndia - PHASE.leaveDelhi);
    if (still) return { ...(t < 0.5 ? d2 : india), zoomT: t < 0.5 ? 1 : 0 };
    return { ...mix(d2, india, easeInOutSine(t), easeInOutCubic(t)), zoomT: 1 - easeInOutCubic(t) };
  }

  /* Chapters and readout */

  function visibility(p, [a, b, c, d]) {
    if (p < a) return 0;
    if (p < b) return smooth((p - a) / (b - a));
    if (p <= c) return 1;
    if (p < d) return 1 - smooth((p - c) / (d - c));
    return 0;
  }

  function updateChapters(p) {
    let active = 0;
    let best = 0;
    chapters.forEach(({ el, range, shift }, index) => {
      const v = visibility(p, range);
      if (v > best) { best = v; active = index; }
      const dy = (1 - v) * (shift === "down" ? -24 : 24);
      el.style.opacity = v.toFixed(3);
      el.style.transform = `translate3d(0, ${dy.toFixed(1)}px, 0)`;
      el.style.visibility = v < 0.02 ? "hidden" : "visible";
      el.style.pointerEvents = v > 0.6 ? "auto" : "none";
      el.setAttribute("aria-hidden", String(v < 0.5));
    });
    navDots.forEach((dot, index) => dot.setAttribute("aria-current", String(index === active)));
    if (cue) cue.style.opacity = String(clamp01(1 - p / 0.05));
  }

  function setRevealed(on) {
    if (on === revealed) return;
    revealed = on;
    storyEl.dataset.reveal = on ? "1" : "0";
    if (!on) hidePopup(true);
  }

  function apply(p, force = false) {
    if (!cameras) return;
    progress = p;
    const cam = cameraAt(p);
    const key = [cam.center[0].toFixed(4), cam.center[1].toFixed(4), cam.zoom.toFixed(3), cam.pitch.toFixed(2), cam.bearing.toFixed(2)].join();
    if (force || key !== lastKey) {
      lastKey = key;
      map.jumpTo({ center: cam.center, zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing });
      storyEl.style.setProperty("--z", cam.zoomT.toFixed(3));
    }
    setRevealed(revealed ? cam.zoomT > 0.55 : cam.zoomT > 0.72);
    updateChapters(p);
    scrollList(p);
  }

  // The school list scrolls itself with the story, so it never traps the mouse wheel.
  function scrollList(p) {
    if (!listEl) return;
    const t = clamp01((p - LIST_SCROLL.from) / (LIST_SCROLL.to - LIST_SCROLL.from));
    listEl.scrollTop = t * (listEl.scrollHeight - listEl.clientHeight);
  }

  /* Markers */

  function ensurePopup() {
    if (!popup) {
      popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 20, maxWidth: "280px", className: "school-card" });
    }
    return popup;
  }

  function cardContent(school) {
    const root = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = school.name;
    const reach = document.createElement("span");
    reach.className = "school-card-reach";
    reach.textContent = school.reported
      ? `${formatNumber(school.students)} ${school.students === 1 ? "student" : "students"} watched`
      : "Student count not reported";
    root.append(name, reach);
    if (school.date) {
      const added = document.createElement("span");
      added.className = "school-card-date";
      added.textContent = `Added ${dayFormat.format(school.date)}`;
      root.append(added);
    }
    return root;
  }

  function showPopup(marker) {
    ensurePopup().setLngLat(marker.lngLat).setDOMContent(cardContent(marker.school)).addTo(map);
  }

  function hidePopup(force) {
    if (pinned && !force) return;
    pinned = null;
    if (popup) popup.remove();
    markers.forEach((m) => m.el.classList.remove("is-active"));
  }

  function clearMarkers() {
    hidePopup(true);
    markers.forEach((m) => m.marker.remove());
    markers = [];
  }

  function setSchools(nextSchools) {
    clearMarkers();
    schools = nextSchools;
    const placed = schools.filter((s) => s.mappable).sort((a, b) => a.lng - b.lng);
    const maxStudents = Math.max(1, ...placed.map((s) => s.students));

    placed.forEach((school, index) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "pin";
      el.style.setProperty("--i", String(index));
      el.style.setProperty("--d", `${Math.round(12 + 16 * Math.sqrt(school.students / maxStudents))}px`);
      if (!school.reported) el.classList.add("is-unreported");
      const label = school.reported
        ? `${school.name}, ${formatNumber(school.students)} students`
        : `${school.name}, student count not reported`;
      el.setAttribute("aria-label", label);
      el.innerHTML = '<span class="pin-ring"></span><span class="pin-dot"></span>';

      const item = { el, school, lngLat: [school.lng, school.lat] };
      item.marker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(item.lngLat).addTo(map);
      // MapLibre overwrites aria-label with "Map marker"; restore the school's own label.
      el.setAttribute("aria-label", label);

      const open = () => {
        markers.forEach((m) => m.el.classList.toggle("is-active", m === item));
        showPopup(item);
      };
      el.addEventListener("pointerenter", open);
      el.addEventListener("focus", open);
      el.addEventListener("pointerleave", () => hidePopup(false));
      el.addEventListener("blur", () => hidePopup(false));
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        pinned = pinned === item ? null : item;
        if (pinned) open(); else hidePopup(true);
      });
      markers.push(item);
    });

    computeCameras();
    apply(progress, true);
  }

  // Lets the "largest audiences" list light up the matching marker.
  function highlight(school, on) {
    const item = markers.find((m) => m.school === school);
    if (!item) return;
    if (on) {
      markers.forEach((m) => m.el.classList.toggle("is-active", m === item));
      showPopup(item);
    } else {
      hidePopup(false);
    }
  }

  document.addEventListener("click", () => hidePopup(true));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") hidePopup(true); });

  /* Scroll link and lifecycle */

  function scrollToProgress(p) {
    const range = storyEl.offsetHeight - window.innerHeight;
    const top = storyEl.getBoundingClientRect().top + window.scrollY + p * range;
    window.scrollTo({ top, behavior: reduceMotion.matches ? "auto" : "smooth" });
  }
  navDots.forEach((dot) => dot.addEventListener("click", () => scrollToProgress(Number(dot.dataset.p))));

  const proxy = { p: 0 };
  function bindScroll() {
    if (tween) { tween.scrollTrigger.kill(); tween.kill(); }
    tween = gsap.to(proxy, {
      p: 1,
      ease: "none",
      scrollTrigger: {
        trigger: storyEl,
        start: "top top",
        end: "bottom bottom",
        scrub: reduceMotion.matches ? true : 0.7
      },
      onUpdate: () => apply(proxy.p)
    });
  }

  const resizeObserver = new ResizeObserver(() => {
    map.resize();
    computeCameras();
    apply(progress, true);
    ScrollTrigger.refresh();
  });
  resizeObserver.observe(mapEl);

  const motionListener = () => { computeCameras(); bindScroll(); apply(progress, true); };
  reduceMotion.addEventListener("change", motionListener);

  computeCameras();
  bindScroll();
  apply(0, true);
  if (onStatus) onStatus("ready");

  return {
    map,
    setSchools,
    highlight,
    refresh: () => ScrollTrigger.refresh(),
    destroy() {
      resizeObserver.disconnect();
      reduceMotion.removeEventListener("change", motionListener);
      if (tween) { tween.scrollTrigger.kill(); tween.kill(); }
      clearMarkers();
      map.remove();
    }
  };
}

import { loadData, fetchLive, buildModel } from "./data.js";
import { renderStoryText, renderSections, initTabs, buildMotif } from "./sections.js";
import { createStory } from "./story.js";

const REFRESH_MS = 5 * 60 * 1000;
const $ = (id) => document.getElementById(id);

let story = null;
let model = null;

function notice(message) {
  const el = $("notice");
  if (!message) {
    el.hidden = true;
    return;
  }
  el.textContent = message;
  el.hidden = false;
}

function applyData(data) {
  model = buildModel(data);
  renderStoryText(model);
  renderSections(model);
  if (story) story.setSchools(model.schools);
}

// Keeps the "largest audiences" list and the map markers in step.
function wireTopList() {
  const list = $("topList");
  const schoolFor = (target) => {
    const button = target.closest("button");
    if (!button || !model) return null;
    return model.schools.find((s) => `${s.lat},${s.lng},${s.name}` === button.dataset.key) || null;
  };
  const on = (event) => { const school = schoolFor(event.target); if (school && story) story.highlight(school, true); };
  const off = (event) => { const school = schoolFor(event.target); if (school && story) story.highlight(school, false); };
  list.addEventListener("pointerover", on);
  list.addEventListener("focusin", on);
  list.addEventListener("pointerout", off);
  list.addEventListener("focusout", off);
}

async function addMotif() {
  try {
    const response = await fetch(new URL("../data/india-states.geojson", import.meta.url));
    const svg = buildMotif(await response.json());
    document.querySelectorAll(".motif").forEach((host) => host.appendChild(svg.cloneNode(true)));
  } catch (err) {
    console.error("Could not draw the map motif:", err);
  }
}

async function start() {
  initTabs();
  wireTopList();
  addMotif();

  const storyEl = $("story");
  const storyReady = createStory({ storyEl, mapEl: $("map") })
    .then((instance) => { story = instance; })
    .catch((err) => {
      console.error("Map story unavailable:", err);
      storyEl.classList.add("is-static");
      notice("The interactive map could not be loaded, so the story is shown without it.");
    });

  const { data, stale } = await loadData();
  if (data) {
    applyData(data);
    if (stale) notice("Live data is unavailable right now. Showing the last saved results.");
  } else {
    notice("Could not load the data. Please refresh the page in a moment.");
  }

  await storyReady;
  if (story && model) story.setSchools(model.schools);
  document.documentElement.classList.add("is-ready");

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => story && story.refresh());

  setInterval(async () => {
    if (document.hidden) return;
    try {
      applyData(await fetchLive());
      notice("");
    } catch (err) {
      console.error("Background refresh failed:", err);
    }
  }, REFRESH_MS);
}

start();

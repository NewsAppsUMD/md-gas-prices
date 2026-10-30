const REGIONS = ["A", "B", "C", "D-1", "D-2", "E"];
const DATA = "../data/";

const PRODUCT_NAMES = {
  unl87: "Unleaded 87 / E10",
  ulsho2: "#2 ULS heating oil",
  ulsd_clear: "ULS diesel, clear",
  ulsd_dyed: "ULS diesel, dyed",
  ulsd_b5: "ULSD B5",
  b5_soy: "Soy biodiesel B5",
  e85: "E85",
};
const GROUPS = {
  "bulk/tankwagon": "Bulk delivery – tankwagon",
  "bulk/transport": "Bulk delivery – transport",
  "consigned/consigned": "Consigned fuel",
};

const state = { product: null, regions: [...REGIONS], range: "90", view: "daily", sort: null };
let products, latest, dates, series, chart;

// ---- data ---------------------------------------------------------------

async function load() {
  const get = (f) => fetch(DATA + f).then((r) => {
    if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
    return r.json();
  });
  const [prices, prods, regions, last] = await Promise.all(
    ["prices.json", "products.json", "regions.json", "latest.json"].map(get));
  products = prods;
  latest = last;

  // series[key][region] = Map(date -> price|null)
  series = {};
  const dateSet = new Set();
  for (const r of prices) {
    const key = `${r.section}/${r.delivery_type}/${r.product_code}`;
    ((series[key] ??= {})[r.region] ??= new Map()).set(r.date, r.price);
    dateSet.add(r.date);
  }
  dates = [...dateSet].sort();
  return regions;
}

const dayNum = (iso) => Date.parse(iso + "T00:00:00Z") / 86400000;

function hasAnyPrice(key, region) {
  const m = series[key]?.[region];
  if (!m) return false;
  for (const v of m.values()) if (v != null) return true;
  return false;
}

function rangeDates() {
  if (state.range === "all") return dates;
  const cutoff = dayNum(dates.at(-1)) - Number(state.range);
  return dates.filter((d) => dayNum(d) > cutoff);
}

// Latest published date on or before `daysBack` days before the last date.
function dateBack(daysBack) {
  const cutoff = dayNum(dates.at(-1)) - daysBack;
  for (let i = dates.length - 1; i >= 0; i--) if (dayNum(dates[i]) <= cutoff) return dates[i];
  return null;
}

function weekStart(iso) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

// ---- formatting ---------------------------------------------------------

const money = (v) => (v == null ? "—" : `$${v.toFixed(4)}`);
const shortDate = (iso, opts = { month: "short", day: "numeric" }) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
const longDate = (iso) => shortDate(iso, { weekday: "short", month: "short", day: "numeric", year: "numeric" });

function deltaEl(v) {
  const span = document.createElement("span");
  span.className = "delta";
  if (v == null) {
    span.classList.add("none");
    span.textContent = "—";
  } else {
    const r = Math.round(v * 10000) / 10000;
    span.classList.add(r > 0 ? "up" : r < 0 ? "down" : "flat");
    span.textContent = r === 0 ? "0.0000" : `${r > 0 ? "▲ +" : "▼ −"}${Math.abs(r).toFixed(4)}`;
  }
  return span;
}

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const regionColor = (region) => cssVar(`--region-${region}`);

function keySwatch(region) {
  const k = document.createElement("span");
  k.className = "key";
  k.style.background = `var(--region-${region})`;
  return k;
}

// ---- URL state ----------------------------------------------------------

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (products.some((x) => x.key === p.get("fuel"))) state.product = p.get("fuel");
  if (p.has("regions")) state.regions = p.get("regions").split(",").filter((r) => REGIONS.includes(r));
  if (["30", "90", "all"].includes(p.get("range"))) state.range = p.get("range");
  if (["daily", "weekly"].includes(p.get("view"))) state.view = p.get("view");
}

function writeHash() {
  const p = new URLSearchParams({
    fuel: state.product, regions: state.regions.join(","), range: state.range, view: state.view,
  });
  history.replaceState(null, "", "#" + p.toString());
}

// ---- controls -----------------------------------------------------------

function buildControls(regionCounties) {
  const select = document.getElementById("product");
  const groups = {};
  for (const p of products) {
    const g = `${p.section}/${p.delivery_type}`;
    if (!groups[g]) {
      groups[g] = document.createElement("optgroup");
      groups[g].label = GROUPS[g] ?? g;
      select.append(groups[g]);
    }
    const opt = new Option(PRODUCT_NAMES[p.product_code] ?? p.product, p.key);
    if (!REGIONS.some((r) => hasAnyPrice(p.key, r))) {
      opt.disabled = true;
      opt.textContent += " (no prices published)";
    }
    groups[g].append(opt);
  }
  state.product ??= products[0].key;
  select.addEventListener("change", () => { state.product = select.value; render(); });

  for (const id of ["range", "view"]) {
    document.getElementById(id).addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      state[id] = b.dataset.value;
      render();
    });
  }

  const byRegion = {};
  for (const [county, r] of Object.entries(regionCounties)) (byRegion[r] ??= []).push(county);

  const fs = document.getElementById("regions");
  const chips = document.getElementById("region-chips");
  for (const r of REGIONS) {
    const item = document.createElement("div");
    item.className = "region-item";
    const label = document.createElement("label");
    label.className = "region-chip";
    label.dataset.region = r;
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = r;
    cb.setAttribute("aria-describedby", `region-pop-${r}`);
    cb.addEventListener("change", () => {
      state.regions = REGIONS.filter((x) => fs.querySelector(`input[value="${x}"]`).checked);
      render();
    });
    const text = document.createElement("span");
    text.textContent = `Region ${r}`;
    label.append(cb, keySwatch(r), text);

    // Pop-up listing the region's counties, shown on hover or keyboard focus.
    const pop = document.createElement("div");
    pop.className = "region-pop";
    pop.id = `region-pop-${r}`;
    pop.setAttribute("role", "tooltip");
    const counties = document.createElement("div");
    counties.textContent = (byRegion[r] ?? []).join(", ");
    const note = document.createElement("div");
    note.className = "region-pop-note";
    note.textContent = "This fuel isn't offered in this region.";
    pop.append(counties, note);
    item.append(label, pop);
    // Keep the pop-up inside the viewport for chips near the right edge.
    const place = () => {
      pop.style.left = "0";
      const over = pop.getBoundingClientRect().right - (document.documentElement.clientWidth - 16);
      if (over > 0) pop.style.left = `${-over}px`;
    };
    item.addEventListener("pointerenter", place);
    item.addEventListener("focusin", place);
    chips.append(item);
  }

  for (const [id, regions] of [["regions-all", REGIONS], ["regions-none", []]]) {
    document.getElementById(id).addEventListener("click", () => {
      state.regions = [...regions];
      render();
    });
  }

  const dl = document.getElementById("counties");
  for (const r of REGIONS) {
    const dt = document.createElement("dt");
    dt.textContent = `Region ${r}`;
    const dd = document.createElement("dd");
    dd.textContent = (byRegion[r] ?? []).join(", ");
    dl.append(dt, dd);
  }

  document.querySelectorAll("#table th").forEach((th) => th.addEventListener("click", () => {
    const col = th.dataset.sort;
    state.sort = state.sort?.col === col ? { col, dir: -state.sort.dir } : { col, dir: col === "region" ? 1 : -1 };
    renderTable();
  }));
}

function syncControls() {
  document.getElementById("product").value = state.product;
  for (const id of ["range", "view"]) {
    document.querySelectorAll(`#${id} button`).forEach((b) =>
      b.setAttribute("aria-checked", String(b.dataset.value === state[id])));
  }
  document.querySelectorAll(".region-chip").forEach((chip) => {
    const r = chip.dataset.region;
    chip.querySelector("input").checked = state.regions.includes(r);
    const offered = hasAnyPrice(state.product, r);
    chip.classList.toggle("unavailable", !offered);
    chip.parentElement.classList.toggle("unavailable", !offered);
  });
  document.getElementById("regions-all").disabled = state.regions.length === REGIONS.length;
  document.getElementById("regions-none").disabled = state.regions.length === 0;
}

function noRegionsMessage() {
  const p = document.createElement("p");
  p.className = "empty";
  p.textContent = "No regions selected. Pick one or more regions above.";
  return p;
}

// ---- tiles --------------------------------------------------------------

function renderTiles() {
  document.getElementById("latest-note").textContent =
    `As of ${longDate(latest.date)}. Day change vs ${shortDate(latest.prev_day_date)}; ` +
    `week change vs ${shortDate(latest.prev_week_date)}.`;
  const box = document.getElementById("tiles");
  box.replaceChildren();
  if (!state.regions.length) {
    box.append(noRegionsMessage());
    return;
  }
  const now = latest.prices[state.product] ?? {};
  for (const r of state.regions) {
    const v = now[r] ?? {};
    const tile = document.createElement("div");
    tile.className = "tile";
    const name = document.createElement("div");
    name.className = "name";
    name.append(keySwatch(r), `Region ${r}`);
    const price = document.createElement("div");
    price.className = "price";
    price.textContent = money(v.price);
    const deltas = document.createElement("div");
    deltas.className = "deltas";
    for (const [label, d] of [["Day", v.day_change], ["Week", v.week_change]]) {
      const row = document.createElement("div");
      const l = document.createElement("span");
      l.textContent = `${label} `;
      row.append(l, deltaEl(d));
      deltas.append(row);
    }
    tile.append(name, price, deltas);
    box.append(tile);
  }
}

// ---- chart --------------------------------------------------------------

function chartData() {
  const ds = rangeDates();
  const regions = state.regions.filter((r) => hasAnyPrice(state.product, r));
  const get = (r, d) => series[state.product]?.[r]?.get(d) ?? null;

  if (state.view === "daily") {
    return {
      labels: ds,
      sets: regions.map((r) => ({ region: r, data: ds.map((d) => get(r, d)) })),
    };
  }
  const weeks = [...new Set(ds.map(weekStart))];
  return {
    labels: weeks,
    sets: regions.map((r) => ({
      region: r,
      data: weeks.map((w) => {
        const vals = ds.filter((d) => weekStart(d) === w).map((d) => get(r, d)).filter((v) => v != null);
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      }),
    })),
  };
}

// Vertical hairline at the hovered x position.
const crosshair = {
  id: "crosshair",
  afterDatasetsDraw(c) {
    const active = c.tooltip?.getActiveElements?.() ?? [];
    if (!active.length) return;
    const x = active[0].element.x;
    const { top, bottom } = c.chartArea;
    c.ctx.save();
    c.ctx.strokeStyle = cssVar("--axis");
    c.ctx.lineWidth = 1;
    c.ctx.beginPath();
    c.ctx.moveTo(x, top);
    c.ctx.lineTo(x, bottom);
    c.ctx.stroke();
    c.ctx.restore();
  },
};

// Six region colors can't all be told apart by color alone (especially with
// color-vision deficiency), so each line also gets a label at its right end.
// Labels are nudged apart vertically so close lines don't overlap.
const END_LABEL_GAP = 14;
const endLabels = {
  id: "endLabels",
  afterDatasetsDraw(c) {
    const items = [];
    c.data.datasets.forEach((ds, i) => {
      const points = c.getDatasetMeta(i).data;
      for (let j = ds.data.length - 1; j >= 0; j--) {
        if (ds.data[j] != null) {
          items.push({ y: points[j].y, x: points[j].x, text: ds.label.replace("Region ", ""), color: ds.borderColor });
          break;
        }
      }
    });
    items.sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) {
      items[i].y = Math.max(items[i].y, items[i - 1].y + END_LABEL_GAP);
    }
    const overflow = items.length ? items.at(-1).y - c.chartArea.bottom : 0;
    if (overflow > 0) items.forEach((it) => (it.y -= overflow));

    const { ctx } = c;
    ctx.save();
    ctx.font = "12px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillStyle = cssVar("--text-secondary");
    const x = c.chartArea.right + 6;
    for (const it of items) {
      ctx.strokeStyle = it.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, it.y);
      ctx.lineTo(x + 10, it.y);
      ctx.stroke();
      ctx.fillText(it.text, x + 14, it.y);
    }
    ctx.restore();
  },
};

function renderChart() {
  const { labels, sets } = chartData();
  const weekly = state.view === "weekly";
  document.getElementById("chart-note").textContent = weekly
    ? "Weekly average of published days, labeled by the Monday of each week."
    : "Every published day (Monday–Saturday).";
  const empty = document.getElementById("chart-empty");
  empty.hidden = sets.length > 0;
  empty.textContent = state.regions.length
    ? "No prices published for this fuel in the selected regions."
    : "No regions selected. Pick one or more regions above.";
  document.querySelector(".chart-wrap").hidden = sets.length === 0;

  const grid = cssVar("--grid");
  const muted = cssVar("--text-muted");
  const surface = cssVar("--surface");
  const datasets = sets.map((s) => ({
    label: `Region ${s.region}`,
    data: s.data,
    borderColor: regionColor(s.region),
    backgroundColor: regionColor(s.region),
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 4,
    pointHoverBorderColor: surface,
    pointHoverBorderWidth: 2,
    spanGaps: false,
    tension: 0,
  }));
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    layout: { padding: { right: 44 } },
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: cssVar("--text-primary"),
        titleColor: surface,
        bodyColor: surface,
        usePointStyle: true,
        itemSort: (a, b) => (b.raw ?? -Infinity) - (a.raw ?? -Infinity),
        callbacks: {
          title: (items) => (weekly ? "Week of " : "") + longDate(items[0].label),
          label: (item) => `${money(item.raw)}  ${item.dataset.label}`,
          labelPointStyle: () => ({ pointStyle: "line", rotation: 0 }),
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { color: cssVar("--axis") },
        ticks: { color: muted, maxTicksLimit: 8, maxRotation: 0, callback(v) { return shortDate(this.getLabelForValue(v)); } },
      },
      y: {
        grid: { color: grid },
        border: { display: false },
        ticks: { color: muted, callback: (v) => `$${Number(v).toFixed(2)}` },
      },
    },
  };

  if (chart) {
    chart.data = { labels, datasets };
    chart.options = options;
    chart.update();
  } else {
    chart = new Chart(document.getElementById("chart"), {
      type: "line", data: { labels, datasets }, options, plugins: [crosshair, endLabels],
    });
  }
}

// ---- table --------------------------------------------------------------

function tableRows() {
  const ds = rangeDates();
  const last = dates.at(-1);
  const back = { day: dates.at(-2), week: dateBack(7), month: dateBack(30) };
  return state.regions.map((r) => {
    const m = series[state.product]?.[r] ?? new Map();
    const now = m.get(last) ?? null;
    const diff = (d) => (now == null || d == null || m.get(d) == null ? null : now - m.get(d));
    const inRange = ds.map((d) => m.get(d)).filter((v) => v != null);
    return {
      region: r,
      latest: now,
      day: diff(back.day),
      week: diff(back.week),
      month: diff(back.month),
      min: inRange.length ? Math.min(...inRange) : null,
      max: inRange.length ? Math.max(...inRange) : null,
    };
  });
}

function renderTable() {
  const rows = tableRows();
  if (state.sort) {
    const { col, dir } = state.sort;
    rows.sort((a, b) => {
      if (a[col] == null) return 1;
      if (b[col] == null) return -1;
      return (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * dir;
    });
  }
  document.querySelectorAll("#table th").forEach((th) => {
    const s = state.sort?.col === th.dataset.sort ? state.sort : null;
    if (s) th.setAttribute("aria-sort", s.dir > 0 ? "ascending" : "descending");
    else th.removeAttribute("aria-sort");
  });

  const body = document.querySelector("#table tbody");
  body.replaceChildren();
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 7;
    td.className = "empty-cell";
    td.textContent = "No regions selected.";
    tr.append(td);
    body.append(tr);
  }
  for (const row of rows) {
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    name.append(keySwatch(row.region), `Region ${row.region}`);
    tr.append(name);
    for (const col of ["latest", "day", "week", "month", "min", "max"]) {
      const td = document.createElement("td");
      td.className = "num";
      if (["day", "week", "month"].includes(col)) td.append(deltaEl(row[col]));
      else td.textContent = money(row[col]);
      tr.append(td);
    }
    body.append(tr);
  }
}

// ---- main ---------------------------------------------------------------

function render() {
  writeHash();
  syncControls();
  renderTiles();
  renderChart();
  renderTable();
}

load()
  .then((regions) => {
    readHash();
    buildControls(regions);
    render();
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderChart);
  })
  .catch((err) => {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = `Couldn't load the price data (${err.message}). Serve the repo root over HTTP, ` +
      "e.g. `python3 -m http.server`, and open /site/.";
    document.querySelector("main").prepend(p);
  });

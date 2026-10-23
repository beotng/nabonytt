const CATEGORY_LABELS = {
  all: "Alt",
  news: "Nyheter",
  funny: "Morsomt 😂",
  event: "Arrangementer",
  traffic_weather: "Trafikk og vær",
  culture_sport: "Kultur og sport",
  lost_found: "Mistet og funnet",
  marketplace: "Kjøp, salg og gis bort",
  other: "Annet",
};
const SOURCE_LABELS = { rss: "Nyhet", facebook: "Facebook", tips: "Lesertips" };

const $ = (id) => document.getElementById(id);
const state = { data: null, category: "all" };

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) if (c != null) node.append(c);
  return node;
}

const safeUrl = (u) => (u && /^https?:\/\//i.test(u) ? u : null);

function timeAgo(iso) {
  const min = Math.round((Date.now() - new Date(iso)) / 60_000);
  if (min < 1) return "akkurat nå";
  if (min < 60) return `${min} min siden`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} t siden`;
  const d = Math.round(h / 24);
  return d === 1 ? "i går" : `${d} dager siden`;
}

async function load() {
  const res = await fetch("/api/feed");
  state.data = await res.json();
  render();
}

function visibleItems() {
  const { items } = state.data;
  const q = $("search").value.trim().toLowerCase();
  const localOnly = $("local-only").checked;
  let list = items.filter((i) => {
    if (localOnly && i.ai && i.ai.localScore < 5) return false;
    if (q && !`${i.ai?.headline} ${i.ai?.summary} ${i.title} ${i.text}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const counts = { all: list.length };
  for (const i of list) {
    const c = i.ai?.category ?? "other";
    counts[c] = (counts[c] ?? 0) + 1;
  }
  if (state.category !== "all") list = list.filter((i) => (i.ai?.category ?? "other") === state.category);

  const sort = $("sort").value;
  const score = (i) => (sort === "fun" ? i.ai?.funScore : i.ai?.localScore) ?? -1;
  if (sort !== "new") list = [...list].sort((a, b) => score(b) - score(a) || new Date(b.publishedAt) - new Date(a.publishedAt));
  return { list, counts };
}

function render() {
  const d = state.data;
  $("place").textContent = `· ${d.location.name}`;
  document.title = `Nabonytt · ${d.location.name}`;
  $("demo-banner").hidden = !d.demo;
  $("status").textContent = d.refreshing
    ? "Henter og oppsummerer nye saker…"
    : d.lastRefresh
      ? `Oppdatert ${timeAgo(d.lastRefresh)} · ${d.items.length} saker`
      : "Henter saker for første gang…";
  $("refresh").disabled = d.refreshing;

  renderDigest(d);
  const { list, counts } = visibleItems();
  renderChips(counts);
  $("feed").replaceChildren(...list.map(card));
  $("empty").hidden = list.length > 0;
  renderSources(d.sources);
}

function renderDigest(d) {
  const dg = d.digest;
  $("digest").hidden = !dg;
  if (!dg) return;
  $("digest-title").textContent = dg.title;
  $("digest-intro").textContent = dg.intro;
  const byId = Object.fromEntries(d.items.map((i) => [i.id, i]));
  $("digest-highlights").replaceChildren(
    ...dg.highlights
      .filter((h) => byId[h.id])
      .map((h) =>
        el("li", {}, `${byId[h.id].ai?.emoji ?? "•"} `, el("a", { href: `#item-${h.id}`, textContent: h.line, onclick: () => flash(h.id) })),
      ),
  );
}

function flash(id) {
  const node = $(`item-${id}`);
  if (!node) return;
  node.classList.add("flash");
  setTimeout(() => node.classList.remove("flash"), 1600);
}

function renderChips(counts) {
  const chips = Object.entries(CATEGORY_LABELS)
    .filter(([key]) => key === "all" || counts[key] || key === state.category)
    .map(([key, label]) =>
      el(
        "button",
        {
          className: "chip",
          role: "tab",
          ariaSelected: String(state.category === key),
          onclick: () => {
            state.category = key;
            render();
          },
        },
        label,
        el("span", { className: "n", textContent: counts[key] ?? 0 }),
      ),
    );
  $("chips").replaceChildren(...chips);
}

function card(item) {
  const ai = item.ai;
  const url = safeUrl(item.url);
  const meta = el(
    "div",
    { className: "meta" },
    ai ? el("span", { className: `tag${ai.category === "funny" ? " fun" : ""}`, textContent: CATEGORY_LABELS[ai.category] ?? ai.category }) : null,
    el("span", { textContent: `${SOURCE_LABELS[item.sourceType] ?? ""} · ${item.source}` }),
    el("span", { textContent: timeAgo(item.publishedAt) }),
    ai && ai.funScore >= 7 ? el("span", { title: "Morsomhetsfaktor", textContent: `😂 ${ai.funScore}/10` }) : null,
    url ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer", textContent: "Les original →" }) : null,
  );

  if (!ai) {
    return el(
      "article",
      { className: "card", id: `item-${item.id}` },
      el("div", { className: "head" }, el("span", { className: "emoji", textContent: "⏳" }), el("h3", { textContent: item.title || "Venter på oppsummering" })),
      el("p", { className: "raw", textContent: item.text.slice(0, 280) + (item.text.length > 280 ? "…" : "") }),
      meta,
    );
  }
  return el(
    "article",
    { className: "card", id: `item-${item.id}` },
    el("div", { className: "head" }, el("span", { className: "emoji", textContent: ai.emoji }), el("h3", { textContent: ai.headline })),
    el("p", { textContent: ai.summary }),
    meta,
  );
}

function renderSources(sources) {
  $("sources").replaceChildren(
    ...Object.entries(sources ?? {}).map(([name, s]) =>
      el(
        "li",
        {},
        el("span", { className: s.ok ? "ok" : "err", textContent: "● " }),
        `${name} `,
        el("span", { className: "muted", textContent: s.ok ? `(${s.count} saker)` : `(feil: ${s.error})` }),
      ),
    ),
  );
}

$("refresh").addEventListener("click", async () => {
  $("refresh").disabled = true;
  $("status").textContent = "Henter og oppsummerer nye saker…";
  try {
    await fetch("/api/refresh", { method: "POST" });
  } finally {
    await load();
  }
});
for (const id of ["sort", "local-only", "search"]) $(id).addEventListener("input", render);

$("tip-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = form.querySelector("button");
  btn.disabled = true;
  $("tip-msg").textContent = "Oppsummerer…";
  try {
    const res = await fetch("/api/tips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    form.reset();
    $("tip-msg").textContent = "Takk! Tipset ligger nå i feeden.";
    await load();
    flash(body.item.id);
  } catch (err) {
    $("tip-msg").textContent = `Noe gikk galt: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

await load();
setInterval(load, 60_000);

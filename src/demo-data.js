// Made-up sample items so the UI can be tried without network access or an
// API key (DEMO=1). None of these are real events.

const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();

const samples = [
  ["rss", "Eksempelavisa", 1, "news", 2, 9, "🏗️", "Ny gang- og sykkelvei i Bossekop åpner neste uke",
    "Den nye gang- og sykkelveien langs hovedveien i Bossekop er nesten ferdig, og kommunen regner med åpning neste uke. Strekningen skal gjøre skoleveien tryggere."],
  ["facebook", "Eksempelgruppa i Alta", 2, "funny", 9, 10, "🫎", "Elg tok seg en pause på trampolinen",
    "En alting våknet til en uvanlig gjest i hagen i Elvebakken: en elg som sto og tygget på bjørkegreiner med begge forbeina på familiens trampoline. Elgen ruslet videre etter en halvtime, trampolinen overlevde."],
  ["facebook", "Eksempelgruppa i Alta", 3, "lost_found", 4, 10, "🧤", "Rosa votter funnet ved Alta sentrum",
    "Et par små rosa strikkevotter er hengt opp på gjerdet ved busstoppet i sentrum. Eieren kan hente dem der."],
  ["rss", "Eksempel-NRK", 4, "traffic_weather", 1, 7, "❄️", "Kuldegrader og glatte veier i Vest-Finnmark",
    "Meteorologene varsler kraftig temperaturfall i natt. Statens vegvesen ber bilister i Alta-området om å ta det rolig i morgenrushet."],
  ["facebook", "Eksempelgruppa i Alta", 5, "marketplace", 3, 10, "🛷", "Gis bort: gammel kjelke med mye sjel",
    "En familie i Kaiskuru gir bort en godt brukt kjelke «med tre generasjoner akeerfaring». Først til mølla."],
  ["rss", "Eksempelavisa", 6, "culture_sport", 5, 9, "🐕", "Hundekjørere trener mot vinterens løp",
    "Flere kjørere fra Alta-området er i gang med høsttrening på barmark. Arrangørene melder om god påmelding til vinterens langdistanseløp."],
  ["facebook", "Eksempelgruppa i Alta", 8, "funny", 8, 10, "🚗", "Noen har strikket lue til parkeringsautomaten",
    "Parkeringsautomaten ved et kjøpesenter i Alta har fått en hjemmestrikket lue med dusk. Ingen vet hvem som sto bak, men kommentarfeltet er enig om at den trengte det."],
  ["rss", "Eksempelavisa", 10, "event", 6, 9, "🎶", "Konsert og kakesalg på kulturhuset lørdag",
    "Skolekorpset holder høstkonsert lørdag kl. 14, med kakesalg i pausen. Inntektene går til korpsets tur neste sommer."],
  ["facebook", "Eksempelgruppa i Alta", 14, "funny", 7, 10, "🌌", "Nordlyset var så sterkt at naboen trodde det var lys fra et romskip",
    "Et innlegg om at «noen har glemt å slå av taklyset i himmelen» samlet hundrevis av bilder av nattens nordlys over Alta. Flere skriver at det var høstens beste så langt."],
  ["rss", "Eksempel-NRK", 20, "news", 1, 3, "🏛️", "Fylkestinget behandler nytt budsjett",
    "Fylkestinget skal i neste uke behandle budsjettet for neste år. Samferdsel og skole er blant de store postene."],
];

export function demoStore() {
  const items = {};
  samples.forEach(([sourceType, source, h, category, funScore, localScore, emoji, headline, summary], i) => {
    const id = `demo${i}`;
    items[id] = {
      id,
      sourceType,
      source,
      title: sourceType === "rss" ? headline : "",
      text: summary,
      url: null,
      image: null,
      publishedAt: hoursAgo(h),
      ai: { headline, summary, category, funScore, localScore, emoji },
    };
  });
  return {
    items,
    lastRefresh: new Date().toISOString(),
    sources: {
      "Eksempelavisa": { type: "rss", ok: true, count: 4, at: hoursAgo(0) },
      "Eksempel-NRK": { type: "rss", ok: true, count: 2, at: hoursAgo(0) },
      "Eksempelgruppa i Alta": { type: "facebook", ok: true, count: 4, at: hoursAgo(0) },
    },
    digest: {
      title: "Dette skjer i Alta i dag (demo)",
      intro: "Kaldt i lufta, varmt i kommentarfeltene! En elg har oppdaget trampolinens gleder, nordlyset tok pusten fra halve byen, og det er konsert med kakesalg på lørdag.",
      highlights: [
        { id: "demo1", line: "Elg på trampoline i Elvebakken: ingen skader, kun æren." },
        { id: "demo0", line: "Tryggere skolevei i Bossekop fra neste uke." },
        { id: "demo3", line: "Glatt i morgen tidlig. Ta det rolig på veien." },
        { id: "demo7", line: "Korpskonsert og kakesalg lørdag kl. 14." },
      ],
      generatedAt: new Date().toISOString(),
    },
  };
}

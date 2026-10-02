function cleanLabel(name) {
  return String(name || "")
    .replace(/\s*[-–|•·]?\s*Epis[óo]dio\s*\d+.*/gi, " ")
    .replace(/\s*\bS\d{1,2}\s*E\d{1,3}\b/gi, " ")
    .replace(/\s*\b\d{1,2}x\d{1,3}\b/gi, " ")
    .replace(/\s*\btemporada\s+\d+.*/gi, " ")
    .replace(/\s*\b(?:dublado|dublagem|dual\s*audio|legendado|legendados|legenda|com\s*legendas)\b/gi, " ")
    .replace(/\s*\[(?:[^\]]*)\]/g, " ")
    .replace(/\s*\b(?:4k|uhd|fhd|full\s*hd|1080p|720p|480p|2160p|hd|sd)\b\s*$/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function vodTitle({ name, year, type = "movie", season = 1, episode = 1, quality = "", source = "" }) {
  const q = quality && quality !== "unknown" ? quality : "";
  const src = String(source || "").toUpperCase();
  const base = cleanLabel(name);
  if (type === "series") {
    const s = String(season || 1).padStart(2, "0");
    const e = String(episode || 1).padStart(2, "0");
    return [`🌊 ${base} · S${s}E${e}`, q, src].filter(Boolean).join(" · ");
  }
  const y = Number(year) || null;
  let label = base;
  const m = label.match(/\(((?:19|20)\d{2})\)\s*$/);
  if (m) {
    if (y) label = `${label.slice(0, m.index).trim()} (${y})`;
  } else if (y && !label.includes(String(y))) {
    label = `${label} (${y})`;
  }
  return [`🌊 ${label}`, q, src].filter(Boolean).join(" · ");
}

function makeHttpStream({
  id,
  type = "series",
  title,
  url,
  episode = 1,
  season = 1,
  quality = "unknown",
  source,
  dubbed = false,
  portuguese = false,
  subtitle = false,
  subtitles = [],
  live = false,
  bingeGroup = "mirror",
  poster = "",
  headers = null,
  notWebReady = null,
}) {
  const q = quality && quality !== "unknown" ? quality : "";
  const hasHeaders = !!(headers && Object.keys(headers).length);
  const notWeb = notWebReady === null ? hasHeaders : !!notWebReady;
  return {
    id,
    type,
    name: q ? `Mirror ${q}` : "Mirror",
    title,
    url,
    episode,
    season,
    dubbed,
    portuguese,
    subtitle,
    japanese: false,
    quality: quality || "unknown",
    size: 0,
    sources: source ? [source] : [],
    trackers: [],
    subtitles,
    poster,
    behaviorHints: {
      notWebReady: notWeb,
      bingeGroup,
      ...(live ? { live: true } : {}),
      ...(hasHeaders ? { proxyHeaders: { request: { ...headers } } } : {}),
    },
    ...(live ? { isLive: true } : {}),
  };
}

function injectTitleQuality(title, quality) {
  const q = String(quality || "").trim();
  if (!q) return title;
  const lines = String(title || "").split("\n");
  const first = (lines[0] || "").replace(/\s*\[\d{3,4}p\]/gi, " ").replace(/\s{2,}/g, " ").trim();
  const segs = first.split(" · ").map(s => s.trim()).filter(s => s !== "");
  if (!segs.length) return title;
  const qi = segs.findIndex(s => /^\d{3,4}p$/.test(s));
  if (qi >= 0) {
    segs[qi] = q;
  } else if (segs.length === 1) {
    segs.push(q);
  } else {
    let idx = segs.length - 1;
    if (idx > 0 && /^proxy$/i.test(segs[idx - 1])) idx -= 1;
    segs.splice(idx, 0, q);
  }
  lines[0] = segs.join(" · ");
  return lines.join("\n");
}

// O link e CONSIDERADO vencido quando a assinatura esta a menos de `FOLGA` de expirar.
//
// FOLGA = 5min, e nao os 30s que estava antes. MEDIDO em 29/09/2026: a assinatura do SPT
// (`vid7...hclod.qzz.io/...?md5=..&expires=`) vale **15 minutos** — o mesmo numero do TTL do
// cache de stream (15min). Com os 30s, o cache guardava o link e o devolvia ainda "valido" por
// quase 15min, e o link MORREU no player's mao: o addon servia `410 Gone`. Era o "as vezes a
// fonte nao abre" do VOD, e o culpado era o cache entregando o que ja nao existia mais.
// A folga e o tempo maximo que o link pode ficar guardado e ainda valer na mao do usuario.
//
// TAMBEM: a assinatura as vezes viaja **dentro de base64** (o relay do worker, `/relay/m/<b64>`,
// e a cifra `/p/<token>.mp4`). Sem decodificar, a checagem via `expires=` nao ve nada e o link
// morto passa. Aqui a gente abre o base64, procura o epoch e trata igual.
const FOLGA_MS = 5 * 60 * 1000;

function expiraDe(u) {
  let m = /[?&]expires=(\d{10,})/i.exec(u);
  if (m) return Number(m[1]) * 1000;
  m = /[?&]exp=(\d{10,})/i.exec(u);
  if (m) return Number(m[1]) * 1000;
  // A assinatura dentro do base64 do relay (`/relay/m/<b64>.m3u8`) ou da cifra (`/p/<token>.mp4`).
  const b64 = /\/(?:relay\/m|p)\/([A-Za-z0-9_-]{20,})/.exec(u);
  if (b64) {
    try {
      const txt = Buffer.from(b64[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      if (/^https?:/i.test(txt)) return expiraDe(txt);
    } catch (_) { /* base64 nao decodificavel: nao da para julgar */ }
  }
  return 0;
}

function hasExpiredSignedUrl(result) {
  const streams = (result && result.streams) || [];
  const agora = Date.now() + FOLGA_MS;
  for (const s of streams) {
    const expira = expiraDe(String(s.url || ""));
    if (expira && expira <= agora) return true;
  }
  return false;
}

module.exports = { makeHttpStream, vodTitle, hasExpiredSignedUrl, injectTitleQuality };

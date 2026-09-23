const PT_BR_REGEX = /\b(pt[- .]?br|portuguese|legendado\s*pt|legenda\s*pt|dublad[ao]|dublagem|portugu[eê]s|brasil|brazilian)\b/i;
const DUBBED_REGEX = /\b(dublad[ao]|dublagem|dub)\b/i;
const { QUALITY_MAP, qualityScore, normalizeQuality } = require("./quality");

function extractQuality(stream) {
  if (stream.quality && stream.quality !== "unknown") {
    return { quality: stream.quality, score: qualityScore(stream.quality) };
  }
  const title = (stream.title || stream.name || "").toLowerCase();
  for (const [q, score] of Object.entries(QUALITY_MAP)) {
    if (title.includes(q)) return { quality: q, score };
  }
  if (/4k|uhd/i.test(title)) return { quality: "2160p", score: 4 };
  return { quality: "unknown", score: 0 };
}

function extractSize(stream) {
  const size = stream.size || 0;
  return size;
}

function extractSeeders(stream) {
  return Number(stream.seeders || 0);
}

function sortBySeeders(streams) {
  const HEALTHY_SEEDERS = 5;
  const MIN_HEALTHY_COUNT = 50;
  const MAX_UNHEALTHY_COUNT = 10;

  const httpStreams = streams.filter(s => s.url && !s.infoHash);
  const torrentStreams = streams.filter(s => !s.url || s.infoHash);
  const healthy = torrentStreams.filter(s => extractSeeders(s) >= HEALTHY_SEEDERS);
  const seeded = torrentStreams.filter(s => extractSeeders(s) >= 1);
  const withSubs = torrentStreams.filter(s => (s.subtitles || []).length > 0);

  let keptTorrents;
  if (healthy.length >= MIN_HEALTHY_COUNT) {
    const result = new Set(healthy);
    for (const s of withSubs) result.add(s);
    keptTorrents = [...result];
  } else if (seeded.length >= MAX_UNHEALTHY_COUNT) {
    const result = new Set(seeded.slice(0, MIN_HEALTHY_COUNT));
    for (const s of withSubs) result.add(s);
    keptTorrents = [...result];
  } else {
    const result = new Set(torrentStreams.slice(0, MAX_UNHEALTHY_COUNT));
    for (const s of withSubs) result.add(s);
    keptTorrents = [...result];
  }
  return [...httpStreams, ...keptTorrents];
}

function sortByVideoQuality(streams) {
  const qualityMap = {};
  for (const stream of streams) {
    const { quality } = extractQuality(stream);
    const key = normalizeQuality(quality) || quality;
    if (!qualityMap[key]) qualityMap[key] = [];
    qualityMap[key].push(stream);
  }
  return Object.keys(qualityMap)
    .sort((a, b) => {
      const aScore = QUALITY_MAP[a] || 0;
      const bScore = QUALITY_MAP[b] || 0;
      return bScore - aScore;
    })
    .flatMap(q => sortBySeeders(qualityMap[q]));
}

function sortBySize(streams) {
  return [...streams].sort((a, b) => extractSize(b) - extractSize(a));
}

function isPtBr(stream) {
  const title = (stream.title || stream.name || "").toLowerCase();
  const isPt = PT_BR_REGEX.test(title);
  const isDubbed = DUBBED_REGEX.test(title);
  const hasPtSubs = (stream.subtitles || []).some(s => {
    const lang = (s.lang || s.label || s.language || "").toLowerCase();
    return lang.includes("pt") || lang.includes("por") || lang.includes("brazil") || lang.includes("portuguese");
  });
  return isPt || isDubbed || stream.dubbed || stream.portuguese || hasPtSubs;
}

function rankAnimeStreams(streams, config = {}) {
  const arr = Array.isArray(streams) ? streams : [];
  const sortType = config.sort || "quality";

  const sortFn = sortType === "size"
    ? sortBySize
    : sortType === "seeders"
      ? (s) => sortBySeeders(s)
      : sortByVideoQuality;

  const ptMap = new WeakMap();
  for (const s of arr) ptMap.set(s, isPtBr(s));

  const ptStreams = arr.filter(s => ptMap.get(s));
  const otherStreams = arr.filter(s => !ptMap.get(s));

  const sortedPt = sortFn(ptStreams);
  const sortedOther = sortFn(otherStreams);

  return [...sortedPt, ...sortedOther].map(stream => {
    const { quality } = extractQuality(stream);
    const seeds = extractSeeders(stream);
    const sizeStr = formatSize(stream.size);
    const source = getSourceName(stream);
    const codename = getSourceNameShort(stream);

    const audioInfo = getAudioInfo(stream);

    const qualityLabel = quality && quality !== "unknown" ? ` ${quality}` : "";
    const name = `Mirror${qualityLabel}`;
    let title;
    if (stream.url && !stream.infoHash) {
      const firstLine = (stream.title || "").split("\n")[0].replace(/^[🎬🌊🌎🧩📺💧☁️]+\s*/u, "").trim() || (stream.type === "tv" ? "Canal" : "Filme");
      const emoji = stream.type === "tv" ? "☁️" : "🌊";
      const lines = [`${emoji} ${firstLine}`];
      if (!(stream.title || "").includes(codename)) lines.push(`${emoji} ${codename}`);
      if (audioInfo) lines.push(`${audioInfo.flag} ${audioInfo.label}`);
      title = lines.join("\n");
    } else {
      title = [
        audioInfo ? `${audioInfo.flag} ${audioInfo.label} | ${quality}` : quality,
        `${source} \u2022 ${sizeStr}`
      ].join("\n");
    }

    const hasSubs = (stream.subtitles || []).length > 0 ? 200 : 0;
    return { ...stream, name, title, _isPtBr: ptMap.get(stream), rankingScore: seeds + (QUALITY_MAP[quality] || 0) * 100 + hasSubs };
  }).sort((a, b) => {
    const aPt = a._isPtBr ? 0 : 1;
    const bPt = b._isPtBr ? 0 : 1;
    if (aPt !== bPt) return aPt - bPt;
    return (b.rankingScore || 0) - (a.rankingScore || 0);
  });
}

function formatSize(bytes) {
  if (!bytes) return "N/A";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function getAudioInfo(stream) {
  if (stream.audioUnknown) return null;
  const hasPtAudio = stream.dubbed || stream.portuguese;
  const hasSubs = stream.subtitle || (stream.subtitles || []).length > 0;

  if (hasPtAudio) return { label: "Português", flag: "\ud83c\udf0e", color: "green" };
  return { label: "Legendado", flag: "\ud83e\udde9", color: "yellow" };
}

const { getSourceDisplayName, getSourceCodename } = require("./source-names");

function getSourceName(stream) {
  const sources = (stream.sources || []).map(s => s.toLowerCase());
  for (const s of sources) {
    const display = getSourceDisplayName(s);
    if (display) return display;
  }
  return getSourceDisplayName("cas");
}

function getSourceNameShort(stream) {
  const sources = (stream.sources || []).map(s => s.toLowerCase());
  for (const s of sources) {
    const codename = getSourceCodename(s);
    if (codename) return codename;
  }
  return "Torrent";
}

module.exports = { rankAnimeStreams, getAudioInfo };

// Porta de `src/lib/video-probe.js` do addon (decisao 36: a qualidade de TODA fonte e
// a RESOLUCAO REAL lida do video — ninguem inventa 720p). As tres diferencas para o
// addon sao de rede, nao de bit:
//   1. a leitura usa `pegar` (`src/lib/http.js`), que e o `fetch` com teto do sandbox;
//   2. `Buffer` NAO existe no runtime do plugin — tudo e `Uint8Array`/`DataView`;
//   3. o timeout e o argumento `ms` do plugin, nao `timeout` do browserFetch.
// A parsing (SPS em MPEG-TS, VisualSampleEntry em MP4) e a mesma, linha por linha.
const { pegar } = require("./http");

const HEAD_BYTES = 160 * 1024;

class BitReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0;
  }
  bit() {
    const byteIndex = this.pos >> 3;
    if (byteIndex >= this.bytes.length) throw new Error("sps: fim dos dados");
    const bit = (this.bytes[byteIndex] >> (7 - (this.pos & 7))) & 1;
    this.pos += 1;
    return bit;
  }
  bits(count) {
    let value = 0;
    for (let i = 0; i < count; i++) value = (value << 1) | this.bit();
    return value >>> 0;
  }
  ue() {
    let zeros = 0;
    while (this.bit() === 0) {
      zeros += 1;
      if (zeros > 32) throw new Error("sps: ue invalido");
    }
    return zeros === 0 ? 0 : (1 << zeros) - 1 + this.bits(zeros);
  }
  se() {
    return this.bit() === 1 ? 1 : -1;
  }
}

function parseSps(rbsp) {
  const r = new BitReader(rbsp);
  const profileIdc = r.bits(8);
  r.bits(8);
  r.bits(8);
  r.ue();
  let chromaFormatIdc = 1;
  if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profileIdc)) {
    chromaFormatIdc = r.ue();
    if (chromaFormatIdc === 3) r.bit();
    r.ue();
    r.ue();
    r.bit();
    if (r.bit() === 1) {
      const scalingListCount = chromaFormatIdc !== 3 ? 8 : 12;
      for (let i = 0; i < scalingListCount; i++) {
        if (r.bit() === 1) {
          const size = i < 6 ? 16 : 64;
          let lastScale = 8;
          let nextScale = 8;
          for (let j = 0; j < size; j++) {
            if (nextScale !== 0) {
              const delta = r.se();
              nextScale = (lastScale + delta + 256) % 256;
            }
            lastScale = nextScale === 0 ? lastScale : nextScale;
          }
        }
      }
    }
  }
  r.ue();
  const picOrderCntType = r.ue();
  if (picOrderCntType === 0) {
    r.ue();
  } else if (picOrderCntType === 1) {
    r.bit();
    r.se();
    r.se();
    const cycle = r.ue();
    for (let i = 0; i < cycle; i++) r.se();
  }
  r.ue();
  r.bit();
  const picWidthInMbsMinus1 = r.ue();
  const picHeightInMapUnitsMinus1 = r.ue();
  const frameMbsOnlyFlag = r.bit();
  return {
    width: (picWidthInMbsMinus1 + 1) * 16,
    height: (2 - frameMbsOnlyFlag) * (picHeightInMapUnitsMinus1 + 1) * 16,
  };
}

function annexBToRbsp(nal) {
  const out = [];
  let zeros = 0;
  for (let i = 0; i < nal.length; i++) {
    if (i + 2 < nal.length && nal[i] === 0 && nal[i + 1] === 0 && nal[i + 2] === 1) {
      out.push(0, 0);
      i += 2;
      continue;
    }
    if (i + 3 < nal.length && nal[i] === 0 && nal[i + 1] === 0 && nal[i + 2] === 0 && nal[i + 3] === 1) {
      out.push(0, 0);
      i += 3;
      continue;
    }
    if (nal[i] === 0 && i > 0 && nal[i - 1] === 0) {
      zeros += 1;
      if (zeros >= 2) continue;
    } else {
      zeros = 0;
    }
    out.push(nal[i]);
  }
  return Uint8Array.from(out);
}


function childBoxes(bytes, start, end) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      size = Number(view.getBigUint64(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) break;
    out.push({ type, start: offset, end: offset + size, bodyStart: offset + header });
    offset += size;
  }
  return out;
}

function boxPath(bytes, start, end, types) {
  let s = start;
  let e = end;
  let box = null;
  for (const type of types) {
    box = childBoxes(bytes, s, e).find(b => b.type === type) || null;
    if (!box) return null;
    s = box.bodyStart;
    e = box.end;
  }
  return box;
}

const VIDEO_CODECS = ["avc1", "avc3", "hvc1", "hev1", "vp08", "vp09", "mp4v", "av01", "dvhe", "dvh1"];

function visualSampleSize(bytes, entry) {
  const type = String.fromCharCode(bytes[entry.start + 4], bytes[entry.start + 5], bytes[entry.start + 6], bytes[entry.start + 7]);
  if (!VIDEO_CODECS.includes(type)) return null;
  for (let o = 20; o <= 28; o += 2) {
    if (entry.start + o + 4 > entry.end) break;
    const width = (bytes[entry.start + o] << 8) | bytes[entry.start + o + 1];
    const height = (bytes[entry.start + o + 2] << 8) | bytes[entry.start + o + 3];
    if (width < 320 || height < 180 || width > 7680 || height > 4320) continue;
    if (width < height * 0.5 || width > height * 2.6) continue;
    return { width, height };
  }
  return null;
}


function mp4VideoResolution(bytes) {
  const moov = childBoxes(bytes, 0, bytes.byteLength).find(b => b.type === "moov");
  if (!moov) return null;
  if (moov.end > bytes.byteLength) return null;
  const traks = childBoxes(bytes, moov.bodyStart, moov.end).filter(b => b.type === "trak");
  for (const trak of traks) {
    const hdlr = boxPath(bytes, trak.bodyStart, trak.end, ["mdia", "hdlr"]);
    if (!hdlr || hdlr.bodyStart + 12 > hdlr.end) continue;
    const handler = String.fromCharCode(bytes[hdlr.bodyStart + 8], bytes[hdlr.bodyStart + 9], bytes[hdlr.bodyStart + 10], bytes[hdlr.bodyStart + 11]);
    if (handler !== "vide") continue;
    const stsd = boxPath(bytes, trak.bodyStart, trak.end, ["mdia", "minf", "stbl", "stsd"]);
    if (!stsd) continue;
    const entry = childBoxes(bytes, stsd.bodyStart + 8, stsd.end)[0];
    if (!entry) continue;
    const size = visualSampleSize(bytes, entry);
    if (size) return size;
  }
  return null;
}

function isMpegTs(bytes) {
  if (!bytes || bytes.byteLength < 188) return false;
  return bytes[0] === 0x47 || (bytes[1] === 0x47 && bytes[0] === 0x47) || (bytes[2] === 0x47 && bytes[1] === 0x47);
}

function bytesLookLikeMp4(bytes) {
  if (!bytes || bytes.byteLength < 16) return false;
  if (bytes[0] === 0x47) return false;
  const head = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
  return head === "ftyp" || head === "moov" || head === "styp" || head === "free" || head === "moof";
}

function scanCodecBox(bytes) {
  const end = bytes.byteLength;
  let best = null;
  for (let i = 0; i + 32 <= end; i++) {
    const type = String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
    if (!VIDEO_CODECS.includes(type)) continue;
    for (let o = 20; o <= 28; o += 2) {
      const width = (bytes[i + o] << 8) | bytes[i + o + 1];
      const height = (bytes[i + o + 2] << 8) | bytes[i + o + 3];
      if (width < 320 || height < 180 || width > 7680 || height > 4320) continue;
      if (width < height * 0.5 || width > height * 2.6) continue;
      if (!best || width * height > best.width * best.height) best = { width, height };
      break;
    }
  }
  return best;
}


function resolutionFromMp4(bytes) {
  try {
    const structured = mp4VideoResolution(bytes);
    if (structured) return structured;
    return scanCodecBox(bytes);
  } catch (_) {}
  return null;
}

function spsFromStream(stream) {
  for (let i = 0; i + 4 < stream.length; i++) {
    if (stream[i] !== 0 || stream[i + 1] !== 0 || stream[i + 2] !== 1) continue;
    if ((stream[i + 3] & 0x1f) !== 7) continue;
    let end = i + 4;
    while (end + 3 < stream.length && !(stream[end] === 0 && stream[end + 1] === 0 && stream[end + 2] === 1)) end += 1;
    if (end - (i + 4) < 4 || end - (i + 4) > 512) continue;
    try {
      const parsed = parseSps(annexBToRbsp(stream.subarray(i + 4, end)));
      if (parsed && parsed.width >= 16 && parsed.height >= 16 && parsed.width <= 7680 && parsed.height <= 4320) return parsed;
    } catch (_) {}
  }
  return null;
}

function assembleVideoStream(packets, pid) {
  const parts = [];
  let started = false;
  for (const p of packets) {
    if (p.pid !== pid) continue;
    const d = p.data;
    if (d[0] === 0 && d[1] === 0 && d[2] === 1) {
      for (let i = 3; i < d.length; i++) parts.push(d[i]);
      started = true;
    }
  }
  return started && parts.length >= 16 ? Uint8Array.from(parts) : null;
}

function parseMpegTs(bytes) {
  let offset = bytes[0] === 0x47 ? 0 : (bytes[1] === 0x47 ? 1 : (bytes[2] === 0x47 ? 2 : -1));
  if (offset < 0) return null;
  const packets = [];
  const total = bytes.byteLength;
  while (offset + 188 <= total) {
    if (bytes[offset] !== 0x47) {
      const next = bytes.indexOf(0x47, offset + 1);
      if (next < 0 || next - offset > 188) break;
      offset = next;
      continue;
    }
    const pid = ((bytes[offset + 1] & 0x1f) << 8) | bytes[offset + 2];
    const control = (bytes[offset + 3] >> 4) & 0x03;
    if (control === 0) break;
    let payloadStart = offset + 4;
    if (control === 2 || control === 3) {
      const adaptationLength = bytes[offset + 4];
      payloadStart = offset + 5 + adaptationLength;
      if (control === 2) { offset += 188; continue; }
    }
    if (payloadStart < offset + 188) packets.push({ pid, data: bytes.subarray(payloadStart, offset + 188) });
    offset += 188;
  }
  if (packets.length < 10) return null;

  let pmtPid = -1;
  for (const p of packets) {
    if (p.pid !== 0) continue;
    const d = p.data;
    const sectionLength = ((d[1] & 0x0f) << 8) | d[2];
    const end = Math.min(sectionLength + 3, d.length);
    let i = 8;
    while (i + 4 < end) {
      const programNumber = (d[i] << 8) | d[i + 1];
      if (programNumber !== 0) {
        const pidOffset = i + 8;
        if (pidOffset < end) pmtPid = ((d[pidOffset] & 0x1f) << 8) | d[pidOffset + 1];
        break;
      }
      i += 4 + ((d[i + 2] & 0x0f) << 8 | d[i + 3]);
    }
    if (pmtPid >= 0) break;
  }
  let videoPid = -1;
  if (pmtPid > 0) {
    for (const p of packets) {
      if (p.pid !== pmtPid) continue;
      const d = p.data;
      const sectionLength = ((d[1] & 0x0f) << 8) | d[2];
      const programInfoLength = ((d[10] & 0x0f) << 8) | d[11];
      let i = 12 + programInfoLength;
      const end = Math.min(sectionLength + 3, d.length);
      while (i + 5 < end) {
        const streamType = d[i];
        const pid = ((d[i + 1] & 0x1f) << 8) | d[i + 2];
        const esInfoLength = ((d[i + 3] & 0x0f) << 8) | d[i + 4];
        if (streamType === 0x1b || streamType === 0x24) { videoPid = pid; break; }
        i += 5 + esInfoLength;
      }
      if (videoPid >= 0) break;
    }
  }
  const candidates = videoPid >= 0 ? [videoPid] : [...new Set(packets.map(p => p.pid))].filter(p => p !== 0 && p !== 4095);
  for (const pid of candidates) {
    const stream = assembleVideoStream(packets, pid);
    if (!stream) continue;
    const found = spsFromStream(stream);
    if (found) return found;
  }
  return null;
}

function detectResolution(bytes) {
  if (!bytes || bytes.byteLength < 16) return null;
  if (bytes[0] === 0x47) return parseMpegTs(bytes);
  const head = String.fromCharCode(bytes[4] ?? 0, bytes[5] ?? 0, bytes[6] ?? 0, bytes[7] ?? 0);
  if (head === "ftyp" || head === "moov" || head === "styp" || head === "free" || head === "moof") return resolutionFromMp4(bytes);
  return null;
}

// `deadline` e' um instante absoluto (ms do Date.now), nao uma duracao.
//
// MEDIDO 02/10/2026: com teto POR REQUISICAO, a sonda do DGO gastou 12,2 s — eram tres
// leituras (playlist -> variante -> segmento) de 3 s cada, e nenhuma delas estourou o
// proprio teto. O orcamento que importa e' o da sonda inteira. Passar um deadline e'
// o que faz a soma respeitar `qualifica`'s teto; a ultima leitura do caminho aceita
// receber o que sobrou.
function sobraAte(deadline, tetoPorRequisicao) {
  const falta = Math.max(1, deadline - Date.now());
  return Math.max(1, Math.min(falta, tetoPorRequisicao));
}

async function fetchRange(url, headers, start, end, ms, deadline) {
  const teto = deadline ? sobraAte(deadline, ms || 8e3) : Math.min(Number(ms) || 8e3, 12e3);
  const res = await pegar(url, {
    ms: teto,
    headers: Object.assign({}, headers || {}, { Range: `bytes=${start}-${end}` })
  });
  if (!res.ok) throw new Error(`video-probe HTTP ${res.status}`);
  const contentRange = String(res.headers.get("content-range") || "");
  const total = Number((contentRange.match(/\/(\d+)\s*$/) || [])[1] || 0);
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    total,
    contentType: String(res.headers.get("content-type") || "")
  };
}
function mp4MetaStart(bytes) {
  if (!bytes || bytes.byteLength < 16) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.byteLength;
  let offset = 0;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) return null;
      size = Number(view.getBigUint64(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header) return null;
    if (type === "moov") return null;
    if (type === "mdat") return offset + size;
    offset += size;
    if (offset <= 0) return null;
  }
  return null;
}

function unpackLanguage(a, b) {
  const value = (a << 8) | b;
  const bits = [(value >> 10) & 0x1f, (value >> 5) & 0x1f, value & 0x1f];
  if (bits.some(v => v < 1 || v > 26)) return null;
  return bits.map(v => String.fromCharCode(v + 0x60)).join("");
}

function audioLanguages(bytes) {
  const langs = new Set();
  const end = bytes.byteLength;
  for (let i = 0; i + 26 <= end; i++) {
    if (bytes[i] !== 0x6d || bytes[i + 1] !== 0x64 || bytes[i + 2] !== 0x68 || bytes[i + 3] !== 0x64) continue;
    const langAt = bytes[i + 4] === 1 ? i + 36 : i + 24;
    if (langAt + 2 > end) continue;
    const code = unpackLanguage(bytes[langAt], bytes[langAt + 1]);
    if (code) langs.add(code);
  }
  return [...langs];
}

// Escolhe o que ler para descobrir a resolucao.
//
// MEDIDO 02/10/2026 no SPT: a playlist vem em fMP4 (`#EXT-X-MAP:URI="init.mp4"` +
// segmentos `.js` que sao fragmentos de MP4). A resolucao esta no `init.mp4` (que
// carrega o `moov`), NAO no segmento de midia — entao um probe que so lê o primeiro
// `.js` devolve `null` e a fonte ficava sem `quality`. Por isso o `init` vai PRIMEIRO.
//
// A pasta e resolvida contra a URL da playlist, e nao contra o playlist mestre
// original: quando a lista tem variantes, quem aponta o `init.mp4` e a lista de midia.
async function firstTargets(url, headers, limit, ms, deadline) {
  if (!/\.m3u8(\?|$)/i.test(url)) return [{ url, size: 1 }];
  const res = await pegar(url, { ms: deadline ? sobraAte(deadline, ms || 8e3) : Math.min(Number(ms) || 8e3, 12e3), headers: headers || {} });
  const text = await res.text();
  const linhas = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#"));
  if (!linhas.length) return [];
  const absolute = linhas.map(l => new URL(l, url).href);
  if (/\.m3u8/i.test(absolute[0])) return firstTargets(absolute[0], headers, limit, ms, deadline);
  const init = (text.match(/#EXT-X-MAP:[^\n]*URI="([^"]+)"/i) || [])[1];
  const alvos = init
    ? [new URL(init, url).href, ...absolute]
    : absolute;
  return alvos.slice(0, limit).map((href, i) => ({ url: href, size: alvos.length, index: i }));
}

const META_BYTES = 256 * 1024;
const MOOV_READ_MAX = 1536 * 1024;

async function readWholeMoov(target, headers, view, total, ms, deadline) {
  const moov = childBoxes(view, 0, view.byteLength).find(b => b.type === "moov");
  if (!moov || moov.end <= view.byteLength || !total) return null;
  if (moov.size > MOOV_READ_MAX) return null;
  try {
    const full = await fetchRange(target.url, headers, moov.start, Math.min(total - 1, moov.end - 1), ms, deadline);
    return new Uint8Array(full.bytes);
  } catch (_) {
    return null;
  }
}

async function probeVideoInfo(url, options = {}) {
  const headers = options.headers || {};
  const maxTargets = options.maxTargets || 2;
  const deadline = Date.now() + Math.min(Number(options.ms) || 8e3, 12e3);
  let targets = [];
  try {
    targets = await firstTargets(url, headers, maxTargets + 1, options.ms, deadline);
  } catch (_) {
    return null;
  }
  const found = (bytes, res) => ({ width: res.width, height: res.height, audioLangs: audioLanguages(bytes) });
  for (const target of targets.slice(0, maxTargets)) {
    let head = null;
    try {
      head = await fetchRange(target.url, headers, 0, HEAD_BYTES - 1, 8e3, deadline);
    } catch (_) {
      continue;
    }
    const view = new Uint8Array(head.bytes);
    if (isMpegTs(view)) {
      const sps = parseMpegTs(view);
      if (sps) return found(view, sps);
      continue;
    }
    const moov = childBoxes(view, 0, view.byteLength).find(b => b.type === "moov");
    if (moov && moov.end <= view.byteLength) {
      const structured = mp4VideoResolution(view);
      if (structured) return found(view, structured);
    } else if (moov && head.total) {
      const whole = await readWholeMoov(target, headers, view, head.total, 8e3, deadline);
      if (whole) {
        const full = mp4VideoResolution(whole) || scanCodecBox(whole);
        if (full) return found(whole, full);
      }
    }
    const metaStart = mp4MetaStart(view);
    if (metaStart !== null && head.total && metaStart < head.total) {
      try {
        const meta = await fetchRange(target.url, headers, metaStart, Math.min(head.total - 1, metaStart + META_BYTES - 1), 8e3, deadline);
        const bytes = new Uint8Array(meta.bytes);
        const res = mp4VideoResolution(bytes) || scanCodecBox(bytes);
        if (res) return found(bytes, res);
      } catch (_) {}
    }
    if (bytesLookLikeMp4(view)) {
      const scanned = scanCodecBox(view);
      if (scanned) return found(view, scanned);
    }
  }
  return null;
}

async function probeResolution(url, options = {}) {
  const info = await probeVideoInfo(url, options);
  return info ? { width: info.width, height: info.height } : null;
}

module.exports = { mp4VideoResolution, scanCodecBox, detectResolution, parseSps, parseMpegTs, resolutionFromMp4, probeResolution, probeVideoInfo, audioLanguages, mp4MetaStart };

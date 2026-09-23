const { browserFetch, makeCache } = require('../lib/scraper-utils');
const { coletar, resolver } = require('../lib/extrator');
const { vodTitle } = require('../lib/stream');
const { penalidadeQuandoAusenteNaConsulta, penalidadeSempre, bonusTemporada, bonusNumeroFinal, PEN_SHIPPUDEN_ALT, PEN_HEN, PEN_BORUTO, PEN_FINAL_SEASON, PEN_FILME, PEN_CLASSICO } = require('../lib/match');

const BASE = 'https://animesdigital.org';
const API = 'https://animesdigital.org/chave/wp/v2';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const pageCache = makeCache(40, 15 * 60 * 1000);
const resultCache = makeCache(60, 5 * 60 * 1000);

async function fetchText(url, headers) {
  const cached = pageCache.get(url);
  if (cached !== null) return cached;
  const res = await browserFetch(url, { headers, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`animesdigital HTTP ${res.status}`);
  const text = await res.text();
  pageCache.set(url, text);
  return text;
}

async function searchAnime(query) {
  try {
    const params = new URLSearchParams({ search: query, _fields: 'id,title,link,slug' });
    const apiUrl = `${API}/posts?${params}`;
    let data = pageCache.get(apiUrl);
    if (data === null) {
      const res = await browserFetch(apiUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        data = await res.json();
        pageCache.set(apiUrl, data);
      }
    }
    if (data) {
      const results = [];
      for (const item of (data || []).slice(0, 5)) {
        const title = (item.title?.rendered || '').replace(/&#8211;/g, '-').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
        const slug = item.slug || '';
        const link = item.link || `${BASE}/video/a/${item.id}/`;
        results.push({ slug, title, url: link, postId: item.id });
      }
      if (results.length) return results;
    }
  } catch (_) {}

  try {
    const html = await fetchText(`${BASE}/pesquisa/?s=${encodeURIComponent(query)}`, { 'User-Agent': UA });
    const results = [];
    const re = /<div class="itemA">\s*<a href="([^"]+)"[^>]*>[\s\S]*?<span class="title_anime">([^<]+)<\/span>/g;
    let match;
    while ((match = re.exec(html)) !== null) {
      results.push({ slug: match[1].split('/').filter(Boolean).pop(), title: match[2].trim(), url: match[1] });
    }
    return results.slice(0, 5);
  } catch (e) {
    console.error(`[animesdigital] searchAnime: ${e.message}`);
    throw e;
  }
}

// Descobre o video com o MOTOR (`src/lib/extrator.js`), nao com as 3 regex que estavam aqui.
//
// O QUE MUDOU (29/09/2026): as regex pegavam a primeira URL de midia que aparecesse na pagina do
// player. Medido no RON: `Bleach` e `One Piece` passam a trazer **2** links (o site tem 2
// servidores) e a escolha deixa de ser "a primeira". O motor tambem enxerga formatos que a regex
// nao via: playlist em `.txt`, video dentro de parametro (`?d=`), objeto de configuracao
// (`window.PlayerConfig = {…}`) e barra escapada (`https:\/\/`).
//
// O caminho que ja funcionava (o `iframe.metaframe` e o `?d=` do anivideo) continua sendo o
// PRIMEIRO a ser tentado, com a mesma marcacao de qualidade. O motor entra quando ele falha e
// como reforco dentro de cada iframe.Ou seja: mudar para melhor, nao para diferente.
async function getVideoUrls(episodeUrl) {
  const hit = resultCache.get(episodeUrl);
  if (hit !== null) return hit;
  const urls = [];
  const viu = new Set();
  const poe = (u, server) => {
    if (!u || viu.has(u)) return;
    viu.add(u);
    urls.push({ url: u, server });
  };
  let lastIframeError = null;
  try {
    const html = await fetchText(episodeUrl, { 'User-Agent': UA });

    const iframeRe = /<iframe[^>]*class=['"]*metaframe[^'"]*['"][^>]*src=['"]([^'"]+)['"]/gi;
    const iframes = [...html.matchAll(iframeRe)].map(m => m[1]);

    for (const iframeSrc of iframes) {
      try {
        if (iframeSrc.includes('anivideo.net')) {
          const u = new URL(iframeSrc);
          const d = u.searchParams.get('d');
          if (d) { poe(d, 'FHD'); continue; }
        }

        const videoRes = await browserFetch(iframeSrc, { headers: { 'User-Agent': UA, 'Referer': episodeUrl }, signal: AbortSignal.timeout(5000) });
        if (!videoRes.ok) throw new Error(`animesdigital iframe HTTP ${videoRes.status}`);
        const videoHtml = await videoRes.text();

        for (const achado of coletar(videoHtml, { base: iframeSrc })) poe(achado.url, servidorDe(achado));
      } catch (e) { lastIframeError = e; }
    }
    // Nada por iframe? O motor assume daqui, e ele faz as DUAS coisas de uma vez: ve iframe que a
    // regex de `metaframe` nao pegou (o site troca a classe sem querer) e segue a cadeia quando o
    // video esta dois saltos abaixo.
    //
    // MEDIDO em 29/09/2026: buscar esses iframes extras SEMPRE custava 3,2s a mais por episodio
    // (One Piece foi de 4,9s para 8,1s) e o orcamento do pedido e 9s. Por isso so entra quando o
    // caminho que ja funcionava nao deu nada.
    if (!urls.length) {
      const achado = await resolver(episodeUrl, { ms: 6000, maxPaginas: 4, referer: BASE, headers: { 'User-Agent': UA } });
      poe(achado.url, servidorDe(achado));
    }
    if (!urls.length) throw lastIframeError || new Error("animesdigital: nenhum video extraido");
  } catch (e) {
    console.error(`[animesdigital] getVideoUrls: ${e.message}`);
    if (!urls.length) throw e;
  }
  if (urls.length) resultCache.set(episodeUrl, urls);
  return urls;
}

// O motor da uma nota; aqui isso vira o rotulo de qualidade que o titulo do stream mostra.
function servidorDe(achado) {
  if (/2160|4k/i.test(achado.url)) return 'FHD';
  if (/\.mp4(\?|#|$)/i.test(achado.url)) return 'FHD';
  if (/1080|master/i.test(achado.url)) return 'FHD';
  return 'HD';
}

async function searchSeriesPage(query) {
  const cacheKey = `serie:${query}`;
  const cached = resultCache.get(cacheKey);
  if (cached !== null) return cached;
  const results = [];
  try {
    const html = await fetchText(`${BASE}/pesquisa/?s=${encodeURIComponent(query)}`, { 'User-Agent': UA });
    const re = /<a href="([^"]*\/anime\/[^"]+)"[^>]*>[\s\S]*?<span class="title_anime">([^<]+)<\/span>/g;
    let match;
    while ((match = re.exec(html)) !== null) {
      const url = match[1].startsWith('http') ? match[1] : `${BASE}${match[1]}`;
      const title = match[2].trim();
      const slug = url.split('/').filter(Boolean).pop();
      results.push({ slug, title, url });
    }
  } catch (_) {}
  if (results.length) {
    resultCache.set(cacheKey, results);
    return results;
  }

  try {
    const slug = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w\s]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").trim();
    const directUrl = `${BASE}/anime/a/${slug}`;
    const html = await fetchText(directUrl, { 'User-Agent': UA });
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/&#8211;/g, '-').replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/ Assistir.*$/i, '').trim() : query;
    results.push({ slug, title, url: directUrl });
  } catch (_) {}
  resultCache.set(cacheKey, results, 60 * 1000);
  return results;
}

function scoreSeries(title, query, season) {
  const t = (title || '').toLowerCase();
  const q = (query || '').toLowerCase();
  let score = 0;
  if (t.includes(q)) score += 10;
  if (q.includes(t.replace(/\s*(dublado|legendado|hd|remaster).*$/i, '').trim())) score += 5;
  if (/\bshippu?uden\b/i.test(t) && /\bshippu?uden\b/i.test(q)) score += 3;
  score += penalidadeSempre(t, [PEN_FILME, PEN_CLASSICO]);
  score += penalidadeQuandoAusenteNaConsulta(t, q, [PEN_SHIPPUDEN_ALT, PEN_HEN, PEN_BORUTO, PEN_FINAL_SEASON]);
  score += bonusTemporada(t, season);
  score += bonusNumeroFinal(t, q, season);
  return score;
}

function findEpisodeUrl(pageHtml, episode) {
  const epNum = String(episode);
  const epTitleRe = new RegExp(`alt="[^"]*Epis[óo]dio\\s*0*${epNum}\\b[^"]*"`, 'i');
  const titleMatch = pageHtml.match(epTitleRe);
  if (!titleMatch) return null;
  const titleIdx = pageHtml.indexOf(titleMatch[0]);
  const before = pageHtml.slice(Math.max(0, titleIdx - 500), titleIdx);
  const hrefMatch = before.match(/href="([^"]+\/video\/[^"]+)"/i);
  if (!hrefMatch) return null;
  return hrefMatch[1].startsWith('http') ? hrefMatch[1] : `${BASE}${hrefMatch[1]}`;
}

function getPaginationInfo(pageHtml) {
  const canonicalMatch = pageHtml.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i);
  const canonicalUrl = canonicalMatch ? canonicalMatch[1] : null;

  const pageNums = [...pageHtml.matchAll(/\/page\/(\d+)\//g)].map(m => parseInt(m[1]));
  const maxPage = pageNums.length ? Math.max(...pageNums) : 1;

  const epRefs = [...pageHtml.matchAll(/alt="[^"]*Epis[óo]dio\s*(\d+)[^"]*"/gi)].map(m => parseInt(m[1]));
  const maxEp = epRefs.length ? Math.max(...epRefs) : 0;

  return { canonicalUrl, maxPage, maxEp, epsPerPage: epRefs.length || 50 };
}

async function fetchSeriesPage(url) {
  return await fetchText(url, { 'User-Agent': UA });
}

async function streamsFor(query, episode, season) {
  try {
    const seenUrls = new Set();
    let seriesPages = await searchSeriesPage(query);
    if (!seriesPages.length) {
      const results = await searchAnime(query);
      if (!results.length) return [];
      const streams = [];
      const videoResults = await Promise.allSettled(
        results.slice(0, 3).filter(item => item.url.includes('/video/')).map(item => getVideoUrls(item.url))
      );
      for (let i = 0; i < videoResults.length; i++) {
        const item = results.slice(0, 3).filter(r => r.url.includes('/video/'))[i];
        const videoUrls = videoResults[i].status === 'fulfilled' ? videoResults[i].value : [];
        if (!videoUrls.length) continue;
        const epMatch = item.title.match(/Epis[óo]dio\s*(\d+)/i);
        const foundEpisode = epMatch ? Number(epMatch[1]) : null;
        if (episode && foundEpisode && foundEpisode !== episode) continue;
        const isDubbed = /dublado|dublagem|dual audio/i.test(item.title);
        const hasPtBr = /pt[- ]?br|portugu[eê]s|brasil|brazilian/i.test(item.title);
        for (const v of videoUrls) {
          if (seenUrls.has(v.url)) continue;
          seenUrls.add(v.url);
          const quality = v.server === 'FHD' ? '1080p' : '720p';
          streams.push({
            id: `animesdigital:${item.slug || item.postId}:${episode}:${v.server}`,
            name: `Mirror ${quality}`,
            title: vodTitle({ name: item.title, type: "series", season: Number(season) || 1, episode: foundEpisode || episode || 1, quality, source: "ron" }),
            url: v.url,
            dubbed: isDubbed,
            portuguese: hasPtBr || isDubbed,
            japanese: !isDubbed,
            subtitle: true,
            quality,
            sources: ['ron'],
            episode: foundEpisode,
          });
        }
      }
      if (!streams.length && videoResults.length && videoResults.every(r => r.status === 'rejected')) throw videoResults[0].reason;
      return streams;
    }

    seriesPages.sort((a, b) => scoreSeries(b.title, query, season) - scoreSeries(a.title, query, season));

    const candidates = seriesPages.filter(s => scoreSeries(s.title, query, season) >= 0).slice(0, 3);
    const pagesHtml = await Promise.allSettled(candidates.map(s => fetchSeriesPage(s.url)));

    const streams = [];
    let firstError = null;
    for (let i = 0; i < candidates.length; i++) {
      const series = candidates[i];
      const pageHtml = pagesHtml[i].status === 'fulfilled' ? pagesHtml[i].value : null;
      if (!pageHtml) continue;

      let epUrl = findEpisodeUrl(pageHtml, episode);

      if (!epUrl && episode) {
        const info = getPaginationInfo(pageHtml);
        if (info.maxPage > 1 && info.canonicalUrl) {
          const basePageUrl = info.canonicalUrl.replace(/\/$/, '');
          const pageToFetch = Math.ceil((info.maxEp - episode + 1) / info.epsPerPage);
          if (pageToFetch > 1 && pageToFetch <= info.maxPage) {
            const paginatedHtml = await fetchSeriesPage(`${basePageUrl}/page/${pageToFetch}/`);
            if (paginatedHtml) epUrl = findEpisodeUrl(paginatedHtml, episode);
          }
        }
      }

      if (!epUrl) continue;
      let videoUrls;
      try {
        videoUrls = await getVideoUrls(epUrl);
      } catch (e) {
        if (!firstError) firstError = e;
        continue;
      }
      if (!videoUrls.length) continue;
      const isDubbed = /dublado|dublagem|dual audio/i.test(series.title);
      const hasPtBr = /pt[- ]?br|portugu[eê]s|brasil|brazilian/i.test(series.title);
      for (const v of videoUrls) {
        if (seenUrls.has(v.url)) continue;
        seenUrls.add(v.url);
        const quality = v.server === 'FHD' ? '1080p' : '720p';
        streams.push({
          id: `animesdigital:${series.slug}:${episode}:${v.server}`,
          name: `Mirror ${quality}`,
          title: vodTitle({ name: series.title, type: "series", season: Number(season) || 1, episode: Number(episode) || 1, quality, source: "ron" }),
          url: v.url,
          dubbed: isDubbed,
          portuguese: hasPtBr || isDubbed,
          japanese: !isDubbed,
          subtitle: true,
          quality,
          sources: ['ron'],
          episode,
        });
      }
      if (streams.length >= 6) break;
    }
    if (!streams.length && firstError) throw firstError;
    return streams;
  } catch (e) {
    console.error(`[animesdigital] streamsFor: ${e.message}`);
    throw e;
  }
}

module.exports = { streamsFor, scoreSeries };

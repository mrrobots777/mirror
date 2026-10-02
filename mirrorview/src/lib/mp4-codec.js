// Le o CODEC do video do cabecalho MP4, do MESMO buffer que ja lemos a duracao.
//
// POR QUE (medido em 29/09/2026, producao): o dono relatou "tela branca e barulho ensurdecedor"
// em filme. Causa medida: **3 de 23 arquivos de painel eram HEVC (H.265)**. Celular e TV que nao
// decodificam H.265 mostram a tela branca e continuam tocando SO O AUDIO — e audio
// reinterpretado na taxa errada e o barulho. Nao e o painel estragado nem o player quebrado: e o
// addon entregando H.265 como se fosse universal.
//
// ESTE LEITOR USA O MESMO BUFFER, ou seja: **custo zero**. A sonda do painel (`probeOnce`) ja
// baixa 256KB do inicio do arquivo para ler o `mvhd` (duracao). O `stsd`, que diz o codec, esta
// na mesma regiao — entao nao ha requisicao nova, nem tempo novo, nem byte novo.
//
// Como o arquivo se organiza: `stsd` guarda uma lista de entradas, e cada entrada comeca com
// 4 bytes de tamanho e 4 bytes de FORMATO (`avc1`, `hvc1`...). O `avc1`/`hvc1` e o do VIDEO; o do
// audio vem logo depois (`.mp4a`/`.mp4a` e `mp4a`) e nao esta na lista acima.
//
// Reconhecidos: `avc1`/`avc3` = H.264 (universal), `hvc1`/`hev1` = H.265 (nao universal),
// `vp09`/`vp9 ` = VP9, `av01` = AV1. Sem evidencia = null, e null NAO e tratado como H.265:
// sem prova nao se condena um arquivo.
const CONHECIDOS = [
  ["avc1", "h264"], ["avc3", "h264"],
  ["hvc1", "hevc"], ["hev1", "hevc"],
  ["vp09", "vp9"], ["vp9 ", "vp9"],
  ["av01", "av1"],
];

function parseMp4Codec(buf) {
  if (!buf || buf.length < 24) return null;
  for (const [tag, codec] of CONHECIDOS) {
    let at = buf.indexOf(tag);
    while (at > 4) {
      const tamanho = buf.readUInt32BE(at - 4);
      // VisualSampleEntry tem 78 bytes; o resto sao caixas de codec (avcC/hvcC) que chegam a
      // algumas KB. Fora dessa faixa o achado e coincidencia de bytes, nao uma entrada real.
      if (tamanho >= 78 && tamanho <= 8192) return { codec, tag, tamanho };
      at = buf.indexOf(tag, at + 4);
    }
  }
  return null;
}

module.exports = { parseMp4Codec };

// Remove de um arquivo os blocos que pertencem ao OUTRO produto.
//
// Nao apaga linha solta: localiza a DECLARACAO (uma expressao regular) e remove ate a
// chave de fecha na coluna 0, ou ate o fim do bloco de chaves. Apagar linha por linha
// deixa chave pendurada — e foi assim que a decisao 155 perdeu um `app.listen` e o
// processo passou a sair com codigo 0 sem escutar, com a barreira inteira verde.
const fs = require("fs");

function fechaLinha(linhas, i) {
  // procura a linha de fecha no nivel 0 (coluna 0) a partir de i
  for (let k = i; k < linhas.length; k++) {
    if (/^\}/.test(linhas[k])) return k;
  }
  throw new Error(`nenhuma chave de fecha em coluna 0 a partir da linha ${i + 1}`);
}

function removeBloco(linhas, inicio) {
  // devolve {ini, fim} do bloco que comeca em `inicio` (0-based)
  let abre = 0;
  for (let k = inicio; k < linhas.length; k++) {
    abre += (linhas[k].match(/\{/g) || []).length - (linhas[k].match(/\}/g) || []).length;
    if (abre === 0 && k > inicio) return { ini: inicio, fim: k };
    if (abre === 0 && k === inicio && /^[^\n]*\}\s*$/.test(linhas[k])) return { ini: inicio, fim: k };
  }
  throw new Error(`bloco nao fecha a partir da linha ${inicio + 1}`);
}

function apagaLinhas(linhas, ini, fim) {
  for (let k = fim; k >= ini; k--) linhas.splice(k, 1);
}

function removePorPadrao(linhas, re, rotulo) {
  for (let i = 0; i < linhas.length; i++) {
    if (re.test(linhas[i])) {
      const { ini, fim } = removeBloco(linhas, i);
      apagaLinhas(linhas, ini, fim);
      console.log(`  - ${rotulo} (linhas ${ini + 1}-${fim + 1})`);
      return true;
    }
  }
  console.log(`  ! nao achei: ${rotulo}`);
  return false;
}

function removeLinha(linhas, re, rotulo) {
  const i = linhas.findIndex((l) => re.test(l));
  if (i < 0) { console.log(`  ! nao achei: ${rotulo}`); return false; }
  linhas.splice(i, 1);
  console.log(`  - ${rotulo} (linha ${i + 1})`);
  return true;
}

module.exports = { removeBloco, removePorPadrao, removeLinha, apagaLinhas };

if (require.main === module) {
  const arquivo = process.argv[2];
  const produto = process.argv[3]; // "mirrorstream" (sem TV) ou "mirrorview" (sem VOD)
  const linhas = fs.readFileSync(arquivo, "utf8").split("\n");
  const regras = require(process.argv[4]);
  for (const r of regras[produto]) {
    if (r.linha) removeLinha(linhas, r.re, r.rotulo);
    else removePorPadrao(linhas, r.re, r.rotulo);
  }
  fs.writeFileSync(arquivo, linhas.join("\n"));
  console.log(`  ${arquivo}: ${linhas.length} linhas`);
}
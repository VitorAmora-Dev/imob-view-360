// Crase dentro de `template:` ou `styles:` inline fecha a string, e o erro que
// sai é um "',' expected" a dezenas de linhas dali. Aconteceu cinco vezes neste
// sprint; contar aspas é mais barato que reconhecer o sintoma.
//
// A primeira versão olhava linha a linha e só examinava as que TINHAM um
// abridor de comentário. Isso deixou passar a quinta ocorrência, que estava
// numa linha de continuação de um <!-- --> de vários parágrafos: sem marcador
// nenhum na própria linha, ela era invisível. Agora o estado do comentário é
// acompanhado ao longo do bloco.
const fs = require('fs');
const { execSync } = require('child_process');

const arquivos = execSync('git ls-files "*.ts"', { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

/** Linhas do bloco que estão dentro de comentário (HTML, CSS ou //). */
function linhasComentadas(bloco) {
  const dentro = [];
  let emHtml = false;
  let emCss = false;

  bloco.split('\n').forEach((linha, i) => {
    // Uma linha conta se ABRE, FECHA ou CONTINUA um comentário.
    const comecouHtml = linha.includes('<!--');
    const fechouHtml = linha.includes('-->');
    const comecouCss = linha.includes('/*');
    const fechouCss = linha.includes('*/');

    const comentada =
      emHtml ||
      emCss ||
      comecouHtml ||
      comecouCss ||
      fechouHtml ||
      fechouCss ||
      linha.trimStart().startsWith('//');

    if (comentada) dentro.push(i);

    if (comecouHtml && !fechouHtml) emHtml = true;
    if (fechouHtml) emHtml = false;
    if (comecouCss && !fechouCss) emCss = true;
    if (fechouCss) emCss = false;
  });

  return new Set(dentro);
}

let problemas = 0;
for (const arquivo of arquivos) {
  // `git ls-files` ainda lista arquivos removidos antes do commit. A limpeza da
  // TV-12 apaga a página legada e o lint precisa validar o estado de trabalho,
  // não tentar reabrir um arquivo que já não existe.
  if (!fs.existsSync(arquivo)) continue;
  const texto = fs.readFileSync(arquivo, 'utf8');
  // Blocos template:` ... ` e styles: [` ... `]
  const re = /(template|styles):\s*\[?\s*`([\s\S]*?)`\s*[,\]]/g;
  let m;
  while ((m = re.exec(texto)) !== null) {
    const bloco = m[2];
    const linhas = bloco.split('\n');
    const comentadas = linhasComentadas(bloco);
    const antes = texto.slice(0, m.index).split('\n').length;

    for (const i of comentadas) {
      if (linhas[i].includes('`')) {
        console.error(
          `${arquivo}:${antes + i}  crase em comentário dentro de template/styles`,
        );
        problemas++;
      }
    }
  }
}

if (problemas) {
  console.error(
    `\n${problemas} ocorrência(s). Crase em comentário inline quebra o build.`,
  );
  process.exit(1);
}
console.log('ok: nenhuma crase em comentário de template/styles inline');

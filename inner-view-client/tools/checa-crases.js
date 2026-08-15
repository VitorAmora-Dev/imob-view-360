// Crase dentro de `template:` ou `styles:` inline fecha a string e o erro que
// sai é um "',' expected" a dezenas de linhas dali. Aconteceu quatro vezes
// neste sprint; contar aspas é mais barato que reconhecer o sintoma.
const fs = require('fs');
const { execSync } = require('child_process');

const arquivos = execSync('git ls-files "*.ts"', { encoding: 'utf8' })
  .split('\n').filter(Boolean);

let problemas = 0;
for (const arquivo of arquivos) {
  const texto = fs.readFileSync(arquivo, 'utf8');
  // Blocos template:` ... ` e styles: [` ... `]
  const re = /(template|styles):\s*\[?\s*`([\s\S]*?)`\s*[,\]]/g;
  let m;
  while ((m = re.exec(texto)) !== null) {
    const bloco = m[2];
    const antes = texto.slice(0, m.index).split('\n').length;
    bloco.split('\n').forEach((linha, i) => {
      // Comentário de HTML ou de CSS com crase dentro.
      if (/(<!--|\/\*|\*|\/\/)/.test(linha) && linha.includes('`')) {
        console.error(`${arquivo}:${antes + i}  crase em comentário dentro de template/styles`);
        problemas++;
      }
    });
  }
}

if (problemas) {
  console.error(`\n${problemas} ocorrência(s). Crase em comentário inline quebra o build.`);
  process.exit(1);
}
console.log('ok: nenhuma crase em comentário de template/styles inline');

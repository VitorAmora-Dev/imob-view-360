/**
 * Qual imagem de um panorama vai para quem consome o tour.
 *
 * O tratado quando existir, o original caso contrário. A substituição acontece
 * na borda de leitura, e não no banco, por três motivos:
 *
 *   - `imageData` continua sendo a única prova do que a câmera realmente
 *     fotografou, e é dele que um retratamento futuro parte;
 *   - o cliente não precisa saber que a etapa de IA existe: enquanto o
 *     tratamento não terminou, o tour serve o original e continua funcionando;
 *   - reverter um tratamento ruim é apagar uma coluna, não recuperar um backup.
 */
export interface ComImagem {
  imageData: string;
  treatedImageData?: string | null;
}

export function imagemServivel<T extends ComImagem>(panorama: T): string {
  return panorama.treatedImageData ?? panorama.imageData;
}

/**
 * Aceita tanto `data:image/jpeg;base64,…` quanto base64 puro.
 *
 * Mora aqui junto de `imagemServivel` porque quem lê a imagem de um panorama
 * quase sempre precisa das duas coisas em seguida — e havia duas versões desta
 * regra no código, uma exigindo o prefixo `data:` e outra cortando em qualquer
 * vírgula. A segunda mutila um base64 que legitimamente contenha vírgula.
 */
export function base64Puro(imageData: string): string {
  const virgula = imageData.indexOf(',');
  return imageData.startsWith('data:') && virgula > 0 ? imageData.slice(virgula + 1) : imageData;
}

/** Aplica `imagemServivel` e some com o campo tratado, que o cliente não usa. */
export function comImagemServivel<T extends ComImagem>(panorama: T): Omit<T, 'treatedImageData'> {
  const { treatedImageData, ...resto } = panorama;
  return { ...resto, imageData: treatedImageData ?? panorama.imageData } as Omit<
    T,
    'treatedImageData'
  >;
}

/**
 * Onde as fotos moram.
 *
 * Existe para que trocar de fornecedor seja mudar de endereço, e não de
 * código: a R2 fala o protocolo da S3, e quem consome esta interface não sabe
 * a diferença. As três implementações — R2, disco e memória — são o que
 * mantém a suíte rodando sem rede e sem credencial.
 *
 * `enderecoPublico` e `enderecoAssinado` devolvem `null` quando aquele modo de
 * entrega não está configurado. Isso NÃO é falha: é o que separa a entrega A
 * (a API lê do balde e transmite) da entrega B (o navegador busca direto). Em
 * desenvolvimento os dois são `null` e tudo continua passando pela API.
 */
export interface ArmazenamentoDeImagens {
  gravar(chave: string, bytes: Buffer): Promise<void>;

  /** `null` quando o objeto não existe — é ele que autoriza a queda para a coluna. */
  ler(chave: string): Promise<Buffer | null>;

  /** `null` quando não há endereço público configurado. */
  enderecoPublico(chave: string): string | null;

  /** `null` quando a implementação não assina, como o disco local. */
  enderecoAssinado(chave: string, segundos: number): Promise<string | null>;

  apagar(chave: string): Promise<void>;

  /**
   * `modificadoEm` vem junto porque a varredura de órfãos precisa dele: a
   * decisão 10 grava no balde ANTES do banco, então existe uma janela em que
   * um objeto legítimo ainda não tem dono. Sem a data, a varredura apagaria
   * uma gravação em curso.
   */
  listar(prefixo: string): AsyncIterable<ObjetoArmazenado>;
}

export interface ObjetoArmazenado {
  chave: string;
  modificadoEm: Date;
}

/**
 * Interface não existe em tempo de execução, e o Nest injeta por valor. O
 * símbolo é o valor.
 */
export const ARMAZENAMENTO = Symbol('ArmazenamentoDeImagens');

export type VarianteDeImagem = 'original' | 'tratada';

/**
 * Cinco minutos. O link assinado é consumido pelo navegador no instante
 * seguinte ao 302; o prazo existe para o caso de a aba ficar aberta, não para
 * ser um cache.
 */
export const VALIDADE_DO_LINK_ASSINADO = 300;

/**
 * A versão que vai no caminho do arquivo.
 *
 * Carimbo próprio, e NÃO `updatedAt`. `updatedAt` é `@updatedAt`: o Prisma o
 * atribui durante a escrita no banco, e a gravação no balde acontece antes
 * dela — derivar a chave de `updatedAt` seria precisar do número antes de ele
 * existir. Nada se perde por isso: a chave inteira fica guardada na coluna.
 */
let ultimaVersao = 0;

export function versaoAgora(agora?: Date): string {
  if (agora) return String(agora.getTime());
  // Monotônico no processo: duas escritas no mesmo milissegundo não colidem.
  ultimaVersao = Math.max(Date.now(), ultimaVersao + 1);
  return String(ultimaVersao);
}

/**
 * Nenhum arquivo em `panoramas/` é sobrescrito. Quando a IA trata o cômodo ou
 * o corretor refotografa a sala, nasce um endereço novo e o payload passa a
 * apontar para ele — caches não confundem versões e não exigem invalidar o
 * objeto anterior. O preço é a versão anterior ficar no balde, que `varrer-orfaos`
 * resolve por centavos.
 */
export function chaveDoPanorama(
  panoramaId: string,
  versao: string,
  variante: VarianteDeImagem,
): string {
  return `panoramas/${panoramaId}/${versao}/${variante}.jpg`;
}

/**
 * A capa mora na MESMA pasta de versão da imagem que a originou, e por isso
 * se deduz da chave dela. É o que evita uma terceira coluna no banco só para
 * guardar um endereço que já é calculável.
 *
 * `original.jpg` e `tratada.jpg` nunca dividem uma pasta: cada gravação cria a
 * sua versão. Então uma pasta tem uma capa, e ela é a daquela imagem.
 */
export function chaveDaCapa(chaveDaImagem: string): string {
  const barra = chaveDaImagem.lastIndexOf('/');
  if (barra <= 0) {
    throw new Error(`Chave de imagem sem diretório: ${chaveDaImagem}`);
  }
  return `${chaveDaImagem.slice(0, barra)}/capa.jpg`;
}

/**
 * Sem versão, de propósito: o envio acontece foto a foto em segundo plano e um
 * reenvio depois de falha de rede precisa REPOR a mesma foto, como o
 * `upsert` por (panorama, índice) já faz no banco.
 */
export function chaveDaCaptura(panoramaId: string, indice: number): string {
  return `capturas/${panoramaId}/${indice}.jpg`;
}

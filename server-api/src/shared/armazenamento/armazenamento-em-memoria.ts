import { ArmazenamentoDeImagens, ObjetoArmazenado } from './armazenamento.port';

/**
 * A porta, num Map.
 *
 * Existe para que toda a suíte de imagem continue rodando sem rede e sem
 * credencial — que é requisito, não conveniência: uma suíte que precisa de
 * bucket é uma suíte que deixa de ser rodada.
 *
 * `gravacoes` é público porque vários testes precisam contar escritas: é assim
 * que se prova que `migrar-imagens` é idempotente (a segunda execução não sobe
 * nada) e que a leitura prefere o endereço (não toca na coluna).
 */
export class ArmazenamentoEmMemoria implements ArmazenamentoDeImagens {
  private readonly objetos = new Map<
    string,
    { bytes: Buffer; modificadoEm: Date }
  >();

  gravacoes = 0;
  leituras = 0;

  /** Sem base, `enderecoPublico` devolve `null` — que é o estado da entrega A. */
  constructor(private readonly base: string | null = null) {}

  async gravar(chave: string, bytes: Buffer): Promise<void> {
    if (chave.startsWith('panoramas/') && this.objetos.has(chave)) {
      throw new Error(`Objeto imutável já existe: ${chave}`);
    }
    this.objetos.set(chave, { bytes, modificadoEm: new Date() });
    this.gravacoes++;
  }

  async ler(chave: string): Promise<Buffer | null> {
    this.leituras++;
    return this.objetos.get(chave)?.bytes ?? null;
  }

  enderecoPublico(chave: string): string | null {
    return this.base ? `${this.base}/${chave}` : null;
  }

  async enderecoAssinado(
    chave: string,
    segundos: number,
  ): Promise<string | null> {
    return this.base ? `${this.base}/${chave}?assinado=${segundos}` : null;
  }

  async apagar(chave: string): Promise<void> {
    this.objetos.delete(chave);
  }

  async *listar(prefixo: string): AsyncIterable<ObjetoArmazenado> {
    // Cópia da lista antes de percorrer: quem varre órfãos apaga durante a
    // iteração, e mutar o Map debaixo do próprio iterador pula entradas.
    for (const [chave, objeto] of [...this.objetos]) {
      if (chave.startsWith(prefixo)) {
        yield { chave, modificadoEm: objeto.modificadoEm };
      }
    }
  }

  /** Só para teste: afirma o conteúdo sem expor o Map. */
  tem(chave: string): boolean {
    return this.objetos.has(chave);
  }

  chaves(): string[] {
    return [...this.objetos.keys()];
  }
}

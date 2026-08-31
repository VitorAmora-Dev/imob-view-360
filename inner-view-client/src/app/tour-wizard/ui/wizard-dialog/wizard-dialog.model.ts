/**
 * O vocabulário do diálogo do wizard: uma pergunta e as respostas possíveis.
 *
 * DONO: Frente A.
 *
 * Fica num arquivo só, sem `@Component` nem `@Injectable`, porque três coisas
 * dependem dele e nenhuma delas deve depender das outras duas: o componente,
 * que só sabe desenhar; o `DialogoDoWizard`, que só sabe esperar a resposta; e
 * a página, que é a única que sabe o QUE se está perguntando e o que fazer com
 * cada resposta.
 */

/**
 * O peso visual da ação — e, com ele, o que a pessoa vê primeiro.
 *
 * `destrutivo` NÃO é o mesmo que "primário em vermelho": ele é deliberadamente
 * mais leve que o primário. Duas ações de peso igual lado a lado transformam
 * a escolha errada num erro de mira, e a errada aqui apaga fotos que não
 * voltam.
 */
export type TomDaAcao = 'primario' | 'destrutivo' | 'neutro';

export interface AcaoDoDialogo {
  /** O que `perguntar()` devolve quando esta ação é escolhida. */
  readonly id: string;
  readonly rotuloKey: string;
  readonly tom: TomDaAcao;
  /**
   * Símbolo à esquerda do rótulo. É um nome do vocabulário do wizard, e não um
   * nome de ícone de biblioteca: quem escolhe o desenho é o componente, e
   * trocá-lo não deve obrigar a mexer em quem faz a pergunta.
   */
  readonly icone?: 'lixeira';
  /**
   * O rótulo do SEGUNDO toque. Preenchê-lo é o que faz a ação pedir
   * confirmação: o primeiro toque troca o rótulo por este, e só o seguinte
   * responde.
   *
   * Não deriva de `tom: 'destrutivo'`, e a diferença tem consequência: "Sair
   * mesmo assim" também é destrutivo e NÃO pede confirmação — ele deixa para
   * trás o que não subiu, não apaga nada. Confirmação é para o que não volta.
   */
  readonly confirmaKey?: string;
}

export interface PerguntaDoWizard {
  readonly tituloKey: string;
  readonly mensagemKey: string;
  /** Em ordem de leitura: a primeira é a da esquerda, e a primeira no foco. */
  readonly acoes: readonly AcaoDoDialogo[];
  /**
   * O X, o toque fora e o Esc respondem?
   *
   * Só marque `true` quando "nada" for uma resposta legítima e segura — tocar
   * em voltar sem querer é o caso que motivou isto. Quando as duas saídas são
   * consequentes (sair perdendo trabalho, ou recomeçar do zero), o silêncio
   * não pode ser o default: ali a pergunta é `false` e só os botões respondem.
   */
  readonly dispensavel: boolean;
  /**
   * Rótulo acessível do X. Só faz sentido com `dispensavel: true`.
   *
   * Existe porque "fechar" descreve o gesto e não a consequência: neste
   * diálogo o X quer dizer "ficar aqui", e é isso que o leitor de tela deve
   * anunciar. Sem o campo, o componente cai em "Fechar".
   */
  readonly fecharKey?: string;
}

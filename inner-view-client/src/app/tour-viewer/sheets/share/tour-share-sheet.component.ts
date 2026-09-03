import { Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { TourSheetComponent } from '../../../components/tour-sheet/tour-sheet.component';
import { VirtualTourService } from '../../../services/virtual-tour.service';
import { ShareTab } from '../../tour-viewer.model';
import { TourViewerStore } from '../../tour-viewer.store';
import { TourEmbedPanelComponent } from './tour-embed-panel.component';

/**
 * As abas, na ordem em que aparecem — e a ÚNICA lista delas.
 *
 * A navegação por setas percorre este array, e o template desenha a partir
 * dele. Uma segunda lista no HTML seria a fonte do bug clássico de tablist:
 * três abas na tela e duas no teclado.
 */
const ABAS: ReadonlyArray<{ id: ShareTab; rotuloKey: string }> = [
  { id: 'link', rotuloKey: 'TOUR_VIEWER.SHARE.TAB_LINK' },
  { id: 'embed', rotuloKey: 'TOUR_VIEWER.SHARE.TAB_EMBED' },
];

/**
 * Altura do sheet Compartilhar.
 *
 * Mais alto que o `[0, 0.62]` do antigo sheet Incorporar porque agora há uma
 * linha de abas acima do mesmo conteúdo. Na parada antiga o interruptor
 * "Mostrar controles" já nascia abaixo da dobra.
 *
 * O `0` da primeira posição é o que permite arrastar até fechar; quem mexer
 * nesta lista precisa mantê-lo.
 */
const PARADAS = [0, 0.72];

/** Dá ids únicos a cada instância — ver `idDaAba`. */
let sequencia = 0;

/**
 * O sheet "Compartilhar tour", com as duas abas do critério.
 *
 * Ele substitui o antigo sheet Incorporar: COMPARTILHAR entrou na barra
 * inferior no lugar de EMBED, e o embed virou a segunda aba daqui. Quem desenha
 * cada aba é outro arquivo — a primeira é o miolo logo abaixo no template, a
 * segunda é o `TourEmbedPanelComponent`, que atravessou inteiro da TV-4.
 *
 * O RODAPÉ é deste componente, e não das abas, porque o `[rodape]` do
 * `TourSheetComponent` é uma projeção de conteúdo: só um filho DIRETO deste
 * template chega lá. É por isso que "Copiar código" mora aqui e lê
 * `store.codigoDoEmbed()` em vez de perguntar ao painel — os dois leem o mesmo
 * sinal, que é o que impede o texto copiado de divergir do que está na tela.
 *
 * A métrica de compartilhamento é best effort em TODOS os canais: falhar ao
 * contá-la nunca impede o link de sair.
 */
@Component({
  selector: 'app-tour-share-sheet',
  standalone: true,
  imports: [TourSheetComponent, TourEmbedPanelComponent, TranslatePipe],
  templateUrl: './tour-share-sheet.component.html',
  styleUrls: ['./tour-share-sheet.component.scss'],
})
export class TourShareSheetComponent {
  private readonly store = inject(TourViewerStore);
  private readonly virtualTourService = inject(VirtualTourService);

  readonly paradas = PARADAS;
  readonly abas = ABAS;

  /**
   * `sheet() === 'share'` e não um booleano próprio: um sheet por vez é
   * invariante do store, e é ele que fecha este ao abrir outro.
   */
  readonly aberto = computed(() => this.store.sheet() === 'share');

  readonly abaAtual = this.store.shareTab;
  readonly link = this.store.linkPublico;
  readonly pedacos = this.store.pedacosDoEmbed;
  readonly codigo = this.store.codigoDoEmbed;

  /**
   * A folha nativa existe neste navegador.
   *
   * Lido UMA vez, na construção, e não a cada detecção de mudanças: é
   * capacidade do navegador, não estado da tela. Sem ela, o botão "Mais
   * opções" simplesmente não é desenhado — mostrá-lo desabilitado anunciaria
   * uma porta que nunca vai abrir, e "Copiar link" já é o caminho completo no
   * desktop.
   */
  readonly temFolhaNativa = typeof navigator !== 'undefined' && !!navigator.share;

  private readonly instancia = ++sequencia;

  /**
   * Ids do par aba/painel, únicos POR INSTÂNCIA.
   *
   * `aria-labelledby` liga o painel à aba por IDREF, e IDREF é global ao
   * documento. Uma constante literal funcionaria hoje — há um só sheet destes
   * na página — e quebraria em silêncio no dia em que houvesse dois: o leitor
   * de tela leria o nome do primeiro para os dois painéis, sem erro nenhum no
   * console.
   */
  idDaAba(aba: ShareTab): string {
    return `tv-share-${this.instancia}-${aba}`;
  }

  idDoPainel(aba: ShareTab): string {
    return `tv-share-${this.instancia}-painel-${aba}`;
  }

  escolherAba(aba: ShareTab): void {
    this.store.shareTab.set(aba);
  }

  /**
   * Setas percorrem as abas, Home/End chegam aos extremos.
   *
   * ATIVAÇÃO AUTOMÁTICA — a seta já troca a aba, e não só o foco. É o padrão
   * que o APG recomenda quando trocar de painel é barato, e aqui é: os dois
   * painéis leem sinais que já estão em memória, sem rede nenhuma. (A faixa de
   * cenas usa a mesma navegação por um motivo diferente, e lá cada seta custa
   * uma equirretangular — está anotado na TV-12.)
   */
  aoTeclar(evento: KeyboardEvent, indiceAtual: number): void {
    const total = ABAS.length;

    let destino: number | null = null;
    if (evento.key === 'ArrowRight') destino = (indiceAtual + 1) % total;
    if (evento.key === 'ArrowLeft') destino = (indiceAtual - 1 + total) % total;
    if (evento.key === 'Home') destino = 0;
    if (evento.key === 'End') destino = total - 1;
    if (destino === null) return;

    evento.preventDefault();
    this.escolherAba(ABAS[destino].id);

    const lista = (evento.currentTarget as HTMLElement).closest('[role="tablist"]');
    lista?.querySelectorAll<HTMLElement>('[role="tab"]')[destino]?.focus();
  }

  /**
   * Copiar NÃO fecha o sheet.
   *
   * Copiar não é escolher: quem copia o código com frequência copia o link em
   * seguida, e fechar aqui obrigaria a reabrir o sheet e reescolher o formato
   * para pegar a segunda metade.
   *
   * A falha é anunciada em vez de engolida. Dizer "Link copiado" quando a
   * permissão de área de transferência foi negada é pior que ficar calado — e
   * ficar calado deixa a pessoa colando o conteúdo antigo sem saber. O texto
   * continua na tela e selecionável, e é isso que o toast manda fazer.
   *
   * O canal é parâmetro porque copiar o LINK e copiar o CÓDIGO são dois
   * destinos diferentes do mesmo tour, e a analytics que não os separa não
   * responde a pergunta que motivou a métrica: por onde o tour circula.
   * Contado só no sucesso — cópia negada não é compartilhamento.
   */
  async copiar(texto: string, chaveDeSucesso: string, canal: string): Promise<void> {
    if (!texto) return;

    try {
      await navigator.clipboard.writeText(texto);
      this.contar(canal);
      this.store.mostrarToast(chaveDeSucesso);
    } catch {
      this.store.mostrarToast('TOUR_VIEWER.TOAST.COPY_ERROR');
    }
  }

  /**
   * A folha nativa do sistema — WhatsApp, Telegram, AirDrop, o que houver ali.
   *
   * Cancelar a folha NÃO é erro e não vira toast: o gesto de fechar é a pessoa
   * dizendo que mudou de ideia, e um aviso de falha ali culparia o app por uma
   * decisão dela. O botão continua na tela para uma segunda tentativa, e
   * "Copiar link" segue ao lado.
   */
  async compartilhar(): Promise<void> {
    const url = this.link();
    if (!url || !navigator.share) return;

    try {
      await navigator.share({ url });
      this.contar('native');
    } catch {
      // Cancelou ou o sistema recusou: nada a dizer.
    }
  }

  /** WhatsApp e e-mail: o link já pronto, num canal escolhido a dedo. */
  abrirWhatsApp(): void {
    const url = this.link();
    if (!url) return;
    this.abrirCanal(`https://wa.me/?text=${encodeURIComponent(url)}`, 'whatsapp');
  }

  abrirEmail(): void {
    const url = this.link();
    if (!url) return;

    const assunto = encodeURIComponent(this.store.tourName());
    this.abrirCanal(`mailto:?subject=${assunto}&body=${encodeURIComponent(url)}`, 'email');
  }

  /** O NOME do sheet vai junto: ver `TourViewerStore.fecharSheet`. */
  fechar(): void {
    this.store.fecharSheet('share');
  }

  /**
   * Um `<a>` de mentira em vez de `window.open`.
   *
   * `window.open` com `mailto:` deixa uma aba em branco em parte dos
   * navegadores quando o sistema entrega a URL ao cliente de e-mail. O `<a>`
   * clicado cobre os dois esquemas com um caminho só, e é o mesmo recurso que o
   * download de cena já usa neste sprint.
   *
   * `rel="noopener noreferrer"` é obrigatório com `target="_blank"`: sem ele a
   * página aberta recebe `window.opener` e pode navegar esta aba para onde
   * quiser.
   */
  private abrirCanal(url: string, canal: string): void {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();

    this.contar(canal);
  }

  private contar(canal: string): void {
    const id = this.store.tourId();
    if (!id) return;

    this.virtualTourService.recordShare(id, canal).subscribe({ error: () => undefined });
  }
}

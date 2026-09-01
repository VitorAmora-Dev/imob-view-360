import { Component, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ToastController } from '@ionic/angular/standalone';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { NavegacaoEntreTelas } from '../../services/navegacao-entre-telas.service';
import { PanoramaImageCache } from '../../services/panorama-image-cache.service';
import { PropertyService } from '../../services/property.service';
import { RascunhoResumo, VirtualTourService } from '../../services/virtual-tour.service';
import { DialogoDoWizard } from '../../tour-wizard/ui/wizard-dialog/dialogo-do-wizard.service';
import { WizardDialogComponent } from '../../tour-wizard/ui/wizard-dialog/wizard-dialog.component';
import { PerguntaDoWizard } from '../../tour-wizard/ui/wizard-dialog/wizard-dialog.model';

/**
 * A tela onde esta lista vive.
 *
 * Recebe o caminho já sem query string nem fragmento — ver `aoVoltarPara`, no
 * construtor, e a armadilha que `NavegacaoEntreTelas` documenta.
 */
const EH_A_TELA_DE_RASCUNHOS = (caminho: string): boolean => caminho === '/rascunhos';

/**
 * Largura da capa que o cartão pede ao servidor.
 *
 * O cartão desenha 110 de altura de capa. Sem o `w`, a rota de preview
 * devolve a equirretangular inteira — e esta lista dispara um download por
 * rascunho, em paralelo, no `ngOnInit`. Eram dezenas de MB no 4G a cada
 * abertura da tela para preencher um punhado de selos.
 */
const LARGURA_DA_CAPA = 320;

/** O que `perguntar()` devolve quando o corretor confirma. */
const APAGAR = 'descartar';

/**
 * A confirmação do descarte, no mesmo diálogo do wizard.
 *
 * SEM `confirmaKey`, e a diferença com o wizard é de contexto, não de
 * descuido: lá o diálogo pergunta COMO sair, e "Descartar" é uma saída lateral
 * dele — por isso o segundo toque. Aqui o corretor já tocou em "Descartar" no
 * cartão, e este diálogo existe só para confirmar aquilo. Uma confirmação
 * dentro de uma confirmação vira ruído, e ruído é o que se aprende a ignorar.
 *
 * `dispensavel` porque desistir é a resposta segura, e é o que o toque errado
 * no botão de 44px encostado no cartão merece encontrar.
 */
const PERGUNTA_DE_DESCARTE: PerguntaDoWizard = {
  tituloKey: 'HOME.DRAFTS_DISCARD_TITLE',
  mensagemKey: 'HOME.DRAFTS_DISCARD_MESSAGE',
  dispensavel: true,
  // "Manter", e não "Fechar": o X aqui tem a mesma consequência do botão azul
  // ao lado, e é isso que o leitor de tela deve anunciar.
  fecharKey: 'HOME.DRAFTS_DISCARD_CANCEL',
  acoes: [
    {
      id: 'manter',
      rotuloKey: 'HOME.DRAFTS_DISCARD_CANCEL',
      tom: 'primario',
    },
    {
      id: APAGAR,
      rotuloKey: 'HOME.DRAFTS_DISCARD_CONFIRM',
      tom: 'destrutivo',
      icone: 'lixeira',
    },
  ],
};

/** Uma linha de `listarRascunhos()`, mais a miniatura quando ela já chegou. */
interface CartaoDeRascunho extends RascunhoResumo {
  /** `blob:` da capa, preenchido depois que `PanoramaImageCache` termina o download. */
  miniatura?: string;
}

/**
 * As capturas que ficaram pela metade, na tela de Rascunhos.
 *
 * As fotos e o tratamento por IA nunca se perderam — sobem durante a própria
 * captura —, mas até esta tarefa não havia nada no aplicativo que levasse o
 * corretor de volta a elas: a listagem de imóveis esconde rascunho de
 * propósito (imóvel sem título apareceria como linha vazia no lugar mais
 * visível do sistema). Esta lista é o caminho de volta.
 *
 * **Só aqui, e não mais numa faixa no topo da home.** Enquanto Rascunhos não
 * era um destino, a faixa era o único jeito de reencontrar uma captura pela
 * metade, e pagava por isso ocupando o topo da tela mais visitada do sistema
 * — inclusive para quem nunca deixou nada pela metade. Agora a aba está fixa
 * no rodapé do celular, sempre à mão, e o topo da home volta a ser do
 * catálogo, que é o que o corretor foi ver.
 *
 * Busca os PRÓPRIOS dados (`listarRascunhos()`) e decide sozinha o que
 * desenhar: com rascunho, os cartões; sem nenhum, o estado vazio — quem veio
 * até aqui procurar merece uma resposta, e não uma tela em branco.
 */
@Component({
  selector: 'app-lista-de-rascunhos',
  standalone: true,
  templateUrl: './lista-de-rascunhos.component.html',
  styleUrls: ['./lista-de-rascunhos.component.scss'],
  imports: [DatePipe, RouterLink, TranslatePipe, WizardDialogComponent],
  providers: [DialogoDoWizard],
})
export class ListaDeRascunhosComponent implements OnInit {
  private readonly virtualTourService = inject(VirtualTourService);
  private readonly propertyService = inject(PropertyService);
  private readonly imagens = inject(PanoramaImageCache);
  private readonly router = inject(Router);
  private readonly navegacao = inject(NavegacaoEntreTelas);
  /**
   * Público porque o template o liga no `<app-tw-wizard-dialog>`.
   *
   * Fornecido por ESTE componente, e não em `root`: a pergunta pertence a esta
   * lista e morre com ela. O wizard tem a sua própria instância, pelo mesmo
   * motivo.
   */
  readonly dialogo = inject(DialogoDoWizard);
  private readonly toastController = inject(ToastController);
  private readonly translate = inject(TranslateService);

  readonly rascunhos = signal<CartaoDeRascunho[]>([]);

  /**
   * Recarrega quando a tela de Rascunhos VOLTA a aparecer, e não só no
   * `ngOnInit`.
   *
   * Publicar uma captura e voltar deixava o cartão dela na lista — a tela
   * afirmando "em andamento" sobre um tour que já estava no ar, até o app ser
   * recarregado do zero. O mesmo valia para descartar dentro do wizard, ou em
   * outro aparelho. A regra de "voltou a aparecer" mora em
   * `NavegacaoEntreTelas`, junto com a armadilha da query string que ela
   * resolve.
   *
   * Pelo roteador, e não por um método público que a `RascunhosPage`
   * chamasse: esta lista é dona do próprio dado (ver o cabeçalho). Um
   * `@ViewChild` na página só para mandar recarregar obrigaria ela a conhecer
   * um filho que hoje só posiciona.
   */
  constructor() {
    this.navegacao
      .aoVoltarPara(EH_A_TELA_DE_RASCUNHOS)
      .pipe(takeUntilDestroyed())
      .subscribe(() => void this.carregar());
  }

  ngOnInit(): void {
    void this.carregar();
  }

  /**
   * Best-effort de propósito: falhar aqui não pode derrubar a tela. O
   * resultado é o mesmo estado vazio de quem não tem rascunho nenhum, e o
   * cabeçalho e a barra continuam servindo para sair daqui.
   *
   * O `try`/`catch` também segura uma falha SÍNCRONA de `listarRascunhos()`
   * (ex.: interceptor que lança antes de devolver o observable) — um `.catch`
   * encadeado só no resultado de `firstValueFrom` não pegaria isso, porque a
   * exceção estouraria antes de `firstValueFrom` chegar a ser chamado.
   */
  private async carregar(): Promise<void> {
    let lista: RascunhoResumo[];
    try {
      lista = await firstValueFrom(this.virtualTourService.listarRascunhos());
    } catch {
      lista = [];
    }

    this.rascunhos.set(lista);
    for (const r of lista) void this.carregarMiniatura(r);
  }

  /**
   * A miniatura passa pelo cache, e não por `<img src="/api/...">` direto.
   *
   * A rota de preview é autenticada, e a tag `<img>` não passa pelo
   * interceptor HTTP — ela não tem como levar o token. O caminho é o mesmo do
   * viewer do wizard: `HttpClient` → `blob:` → tela. Ignorar essa regra foi o
   * que já deixou a tela do tour em branco num bug recente.
   *
   * Pede a variante `'treated'`: é a mesma que o wizard mostra durante a
   * captura, e cai na original sozinha enquanto a montagem por IA não termina
   * (ver o comentário de `urlDoPreview`). E pede com largura: ver
   * `LARGURA_DA_CAPA`.
   */
  private async carregarMiniatura(r: RascunhoResumo): Promise<void> {
    if (!r.capaPanoramaId) return;

    const url = await this.imagens
      .obter(r.capaPanoramaId, 'treated', LARGURA_DA_CAPA)
      .catch(() => '');
    if (!url) return;

    this.rascunhos.update((atual) =>
      atual.map((x) => (x.id === r.id ? { ...x, miniatura: url } : x)),
    );
  }

  retomar(r: CartaoDeRascunho): void {
    void this.router.navigate(['/tour/novo'], {
      queryParams: { rascunho: r.id },
    });
  }

  /**
   * Apaga o IMÓVEL, e não o tour.
   *
   * `VirtualTour.property` é `onDelete: Cascade`: uma chamada derruba tour,
   * panoramas, hotspots e frames de uma vez. Apagar só o tour deixaria um
   * imóvel órfão chamado "Captura em andamento" — e imóvel sem tour nenhum
   * passa pelo filtro da listagem (que esconde quem TEM tour DRAFT, não quem
   * não tem tour nenhum). O descarte pela metade voltaria a aparecer no
   * catálogo como a linha vazia que aquele filtro existe para evitar. Mesma
   * regra de `TourDraftStore.descartarRascunho()`.
   *
   * Por isso a confirmação, no mesmo diálogo da saída do wizard: o botão tem
   * 44px e encosta no cartão — um toque errado apagava, sem pergunta e sem
   * desfazer, as fotos, os hotspots e o tratamento por IA já pago.
   *
   * E o cartão só some se o DELETE tiver dado certo. Engolir a falha e remover
   * o cartão mesmo assim fazia um descarte que não aconteceu parecer concluído
   * — o rascunho reaparecia no próximo carregamento da home, sem explicação.
   */
  async descartar(r: CartaoDeRascunho): Promise<void> {
    if (!(await this.confirmarDescarte())) return;

    try {
      await firstValueFrom(this.propertyService.deleteProperty(r.propertyId));
    } catch {
      await this.avisar(this.texto('HOME.DRAFTS_DISCARD_ERROR'));
      return;
    }

    if (r.capaPanoramaId) this.imagens.liberar(r.capaPanoramaId);
    this.rascunhos.update((atual) => atual.filter((x) => x.id !== r.id));
  }

  /**
   * Só a ação destrutiva confirma. Qualquer outra resposta — "Manter", o X, o
   * toque fora, o Esc — desiste, e nenhuma delas deixa a promise pendurada.
   */
  private async confirmarDescarte(): Promise<boolean> {
    return (await this.dialogo.perguntar(PERGUNTA_DE_DESCARTE)) === APAGAR;
  }

  private async avisar(mensagem: string): Promise<void> {
    const toast = await this.toastController.create({
      message: mensagem,
      duration: 3000,
      position: 'bottom',
      color: 'danger',
    });
    await toast.present();
  }

  private texto(chave: string): string {
    return this.translate.instant(chave) as string;
  }
}

import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { IonContent, IonSpinner } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { CenasSheetComponent } from '../components/cenas-sheet/cenas-sheet.component';
import { PanoramicViewerComponent } from '../components/panoramic-viewer/panoramic-viewer.component';
import { TvToastComponent } from '../tour-viewer/chrome/tv-toast.component';
import { TourHotspotOverlayComponent } from '../tour-viewer/hotspots/tour-hotspot-overlay.component';
import { PalcoDoTour } from '../tour-viewer/palco-do-tour';
import { TourScenesStripComponent } from '../tour-viewer/scenes/tour-scenes-strip.component';
import { TourShareSheetComponent } from '../tour-viewer/sheets/share/tour-share-sheet.component';
import { TourActionsBarComponent } from '../tour-viewer/tour-actions-bar/tour-actions-bar.component';
import { TourViewerStore } from '../tour-viewer/tour-viewer.store';

/**
 * O tour dentro do site de outra pessoa — e agora com o MESMO visualizador que
 * o corretor vê no sistema.
 *
 * Esta página era o `app-panoramic-viewer` cru, com os pontos de passagem no
 * desenho velho e nenhuma faixa de cenas. Eram duas telas para o mesmo
 * trabalho, e a que o cliente final via era a pior.
 *
 * O QUE ELA NÃO IMPORTA É PARTE DO DESENHO. Não há `TourManageSheetComponent`
 * nem `TourDeleteSheetComponent` nesta lista, e a ausência é estrutural de
 * propósito: escondê-los por `@if` seria uma linha que alguém inverte sem
 * perceber, e o que não está no `imports` não pode ser renderizado por engano.
 * O cabeçalho (`TvHeaderComponent`) fica fora por outro motivo — ele mostra o
 * nome do IMÓVEL, que vem de rota autenticada e que o embed não carrega.
 *
 * A outra metade dessa decisão é `TourViewerStore.podeEditar`, que deixou de
 * ser `true` cravado: quem entra por `carregarPorTour()` não edita, e é isso
 * que apaga o botão EDITAR da barra de ações sem um `@if` a mais no template.
 *
 * O store é fornecido AQUI, e não em `root`, pelo mesmo motivo da tela do
 * dono: o estado morre com a página. Fornecê-lo é obrigatório e não opcional —
 * a faixa de cenas e as folhas fazem `inject(TourViewerStore)` diretamente.
 */
@Component({
  selector: 'app-embed',
  templateUrl: './embed.page.html',
  styleUrls: ['./embed.page.scss'],
  standalone: true,
  providers: [TourViewerStore],
  imports: [
    CenasSheetComponent,
    IonContent,
    IonSpinner,
    PanoramicViewerComponent,
    TourActionsBarComponent,
    TourHotspotOverlayComponent,
    TourScenesStripComponent,
    TourShareSheetComponent,
    TranslatePipe,
    TvToastComponent,
  ],
})
export class EmbedPage extends PalcoDoTour implements OnInit {
  private readonly route = inject(ActivatedRoute);

  /**
   * A interface aparece dentro do iframe.
   *
   * É a outra metade do interruptor "Mostrar controles" do sheet Incorporar
   * (TV-4): lá `TourViewerStore.linkPublico()` acrescenta `?controles=0` ao
   * link, e é AQUI que esse parâmetro vira alguma coisa. Sem esta leitura o
   * interruptor gerava uma URL diferente e um embed idêntico — o pior tipo de
   * defeito, porque a tela de quem configura mostra que funcionou.
   *
   * O que ele desliga MUDOU de tamanho junto com esta tela: antes era a lista
   * de ambientes do próprio viewer, a única navegação que havia; agora é a
   * moldura inteira — faixa de cenas e barra de ações. É a mesma promessa do
   * interruptor, e quem já usa o parâmetro vai ver um embed mais limpo, não um
   * embed quebrado.
   *
   * Os PONTOS DE PASSAGEM continuam de pé com `controles=0`, e isso é
   * deliberado. Eles não são moldura: moram numa coordenada da foto, apontam
   * para uma porta que está ali, e são o único jeito de andar pelo tour. Sem
   * eles, `controles=0` entregaria um cômodo só — que é menos do que o embed
   * antigo já fazia, porque lá os sprites do viewer ficavam. É a mesma regra do
   * modo imersivo; o porquê inteiro está no `TourViewerStore`, onde
   * `hotspotsVisiveis` deixou de existir.
   *
   * Lido no `snapshot`, e não observado: um embed não troca de parâmetro sem
   * recarregar o iframe inteiro.
   *
   * Ligado por padrão, e só `controles=0` desliga. Qualquer outro valor —
   * ausente, vazio, `1`, lixo — mantém os controles: um parâmetro que alguém
   * digitou errado não deveria mutilar silenciosamente o tour de quem
   * incorpora.
   */
  mostrarControles = true;

  ngOnInit(): void {
    this.mostrarControles = this.route.snapshot.queryParamMap.get('controles') !== '0';

    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      // Mesmo estado de "não achei o tour": um link sem id e um link com id
      // errado são a mesma coisa para quem clicou.
      this.store.loading.set(false);
      this.store.loadError.set(true);
      return;
    }

    // `carregarPorTour` e NÃO `carregar`: aquele entra por `GET /properties/:id`,
    // que é autenticada, e o visitante não tem token. É também o que põe o
    // store em modo público — ver `podeEditar`.
    //
    // A contagem de visita mora lá dentro, e não aqui: antes esta página a
    // disparava por conta própria, e a tela do dono fazia o mesmo no store.
    // Duas cópias da mesma regra ("uma vez por abertura") é como uma delas
    // passa a contar visita a cada "Tentar de novo".
    void this.store.carregarPorTour(id);
  }
}

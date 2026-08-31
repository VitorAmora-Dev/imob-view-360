import {
  Component,
  DestroyRef,
  OnInit,
  ViewChild,
  computed,
  inject,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, IonContent } from '@ionic/angular/standalone';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AppHeaderComponent } from '../components/app-header/app-header.component';
import { filaDePassagens } from './passagens/fila';
import { TourPublishedComponent } from './published/tour-published.component';
import { StepOrderingComponent } from './steps/step-ordering/step-ordering.component';
import { StepPassagesComponent } from './steps/step-passages/step-passages.component';
import { StepImagesComponent } from './steps/step-images/step-images.component';
import { StepInfoComponent } from './steps/step-info/step-info.component';
import { TourDraftStore } from './tour-draft.store';
import { WizardActionsComponent } from './ui/wizard-actions/wizard-actions.component';
import { WizardStepperComponent } from './ui/wizard-stepper/wizard-stepper.component';

/**
 * Wizard de criação de tour: topbar, stepper, corpo da etapa e barra de ação.
 *
 * DONO: Frente A.
 *
 * A página é só o arranjo — quem sabe algo são o stepper, a barra de ação e
 * cada etapa, todos lendo o mesmo `TourDraftStore`. Por isso ela não tem nem
 * `@Input` nem estado próprio.
 *
 * O store é fornecido AQUI, e não em `root`: o rascunho morre junto com a tela
 * (não há persistência — ver §2.3 do plano do sprint) e "Criar outro tour" é
 * só um `reset()`.
 */
@Component({
  selector: 'app-tour-wizard',
  templateUrl: './tour-wizard.page.html',
  styleUrls: ['./tour-wizard.page.scss'],
  standalone: true,
  providers: [TourDraftStore],
  imports: [
    IonContent,
    TranslatePipe,
    AppHeaderComponent,
    WizardStepperComponent,
    WizardActionsComponent,
    StepImagesComponent,
    StepOrderingComponent,
    StepPassagesComponent,
    StepInfoComponent,
    TourPublishedComponent,
  ],
})
export class TourWizardPage implements OnInit {
  readonly store = inject(TourDraftStore);

  @ViewChild(AppHeaderComponent) private header?: AppHeaderComponent;

  private readonly alertController = inject(AlertController);
  private readonly translate = inject(TranslateService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /**
   * A etapa de passagens entrega a tela para a foto — e só enquanto há foto.
   *
   * O modo imersivo esconde o stepper e a barra de ação no celular (ver o
   * SCSS), e a barra é onde mora o único "Continuar". Com a fila acabada, ou
   * sem conexão nenhuma escolhida, a etapa não mostra foto: mostra um
   * parágrafo. Esconder a barra ali prendia o corretor numa tela quase branca,
   * sem avançar nem voltar — foi o que aconteceu no celular.
   *
   * A condição sai da mesma função pura que a etapa usa para montar a fila, e
   * não de um `@Output` dela: o `PassagensStore` é fornecido pelo componente
   * da etapa, e a página não o alcança. Haver passagem pendente é exatamente
   * o caso em que a etapa monta o visualizador.
   */
  readonly imersivo = computed(
    () =>
      this.store.step() === 3 &&
      !this.store.published() &&
      filaDePassagens(this.store.scenes()).some((p) => !p.feita),
  );

  constructor() {
    // `visibilitychange`, e não `beforeunload`: navegador de celular ignora ou
    // limita o segundo, e ele não dispara quando o SISTEMA mata o app em
    // segundo plano — que é justamente um dos dois jeitos de perder o
    // trabalho que esta tarefa fecha (o outro é o botão de voltar, coberto
    // pelo `tourWizardLeaveGuard`).
    const aoEsconder = () => {
      if (document.visibilityState !== 'hidden') return;
      if (this.store.published() || !this.store.readyScenes().length) return;
      void this.store.salvarRascunho().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', aoEsconder);
    inject(DestroyRef).onDestroy(() =>
      document.removeEventListener('visibilitychange', aoEsconder),
    );
  }

  /**
   * Entrada pela faixa "Capturas em andamento" da home, que navega para
   * `/tour/novo?rascunho=<tourId>`. Sem o parâmetro, o wizard começa vazio
   * como sempre começou — é o mesmo caminho do FAB e do "Criar meu primeiro
   * tour".
   */
  ngOnInit(): void {
    const rascunho = this.route.snapshot.queryParamMap.get('rascunho');
    if (rascunho) void this.retomar(rascunho);
  }

  /**
   * Falhou a retomada: PERGUNTA, nunca segue em frente calado.
   *
   * O `.catch(() => undefined)` que morava aqui dizia que o pior caso era "o
   * wizard abrir vazio, como se tivesse tocado no FAB". Não era. Vazio, mas
   * com `rascunhoTourId` nulo — e a primeira captura chamaria
   * `garantirRascunho()`, que CRIA imóvel e tour DRAFT novos. O rascunho
   * original continuava intacto na faixa, e a home passava a mostrar dois
   * cartões para o que o corretor acha que é uma captura só, com as fotos
   * repartidas entre eles.
   *
   * Ele tocou na faixa exatamente para NÃO recomeçar. Então as duas saídas são
   * tentar de novo ou voltar para a home — nenhuma delas é "siga como tour
   * novo". `backdropDismiss: false` pelo mesmo motivo: fechar no toque de fora
   * devolveria justamente o estado que este alerta existe para impedir.
   */
  private async retomar(tourId: string): Promise<void> {
    try {
      await this.store.retomarRascunho(tourId);
    } catch {
      await this.avisarQueNaoRetomou(tourId);
    }
  }

  /**
   * Salvar falhou na saída: pergunta em vez de deixar sair acreditando.
   *
   * Resolve `false` (fica) no "tentar de novo" — o guard cancela a saída e o
   * corretor vê o aviso da barra, com o botão de repetir. Resolve `true` no
   * "sair mesmo assim", que é escolha informada, e é o que o texto do botão
   * precisa deixar claro.
   *
   * `backdropDismiss: false` porque tocar fora não é resposta: os dois
   * desfechos aqui são consequentes, e o default silencioso seria justamente o
   * que este alerta existe para tirar do caminho.
   */
  private avisarQueNaoSalvou(): Promise<boolean> {
    return new Promise<boolean>((decidir) => {
      void this.alertController
        .create({
          header: this.translate.instant('TOUR_WIZARD.COMMON.SAVE_FAILED_TITLE'),
          message: this.translate.instant('TOUR_WIZARD.COMMON.SAVE_FAILED_MESSAGE'),
          backdropDismiss: false,
          buttons: [
            {
              text: this.translate.instant('TOUR_WIZARD.COMMON.SAVE_FAILED_LEAVE'),
              role: 'destructive',
              handler: () => decidir(true),
            },
            {
              text: this.translate.instant('TOUR_WIZARD.COMMON.SAVE_RETRY'),
              handler: () => decidir(false),
            },
          ],
        })
        .then((alerta) => alerta.present())
        // Mesma regra da cadeia acima: se o próprio alerta não subir, não dá
        // para prender ninguém na tela por causa disso.
        .catch(() => decidir(true));
    });
  }

  private async avisarQueNaoRetomou(tourId: string): Promise<void> {
    const alerta = await this.alertController.create({
      header: this.translate.instant('TOUR_WIZARD.COMMON.RESUME_FAILED_TITLE'),
      message: this.translate.instant('TOUR_WIZARD.COMMON.RESUME_FAILED_MESSAGE'),
      backdropDismiss: false,
      buttons: [
        {
          text: this.translate.instant('TOUR_WIZARD.COMMON.RESUME_FAILED_HOME'),
          role: 'cancel',
          handler: () => {
            void this.router.navigate(['/home']);
          },
        },
        {
          text: this.translate.instant('TOUR_WIZARD.COMMON.RESUME_FAILED_RETRY'),
          handler: () => {
            // Recursão só avança com gesto do corretor: cada rodada nova custa
            // um toque, então rede fora não vira laço de tentativas.
            void this.retomar(tourId);
          },
        },
      ],
    });
    await alerta.present();
  }

  /**
   * "Tentar de novo" do aviso da barra.
   *
   * Fogo-e-esquece de propósito: quem lê o resultado é o próprio
   * `estadoDoSalvamento`, que a barra observa. Um `await` aqui só serviria
   * para reescrever no `catch` o que o sinal já vai dizer.
   */
  salvarDeNovo(): void {
    void this.store.salvarRascunho().catch(() => undefined);
  }

  /** O header encolhe com o scroll e depende do container do ion-content. */
  onScroll(event: CustomEvent<{ scrollTop: number }>): void {
    this.header?.onContentScroll(event.detail.scrollTop);
  }

  /**
   * A decisão de saída em voo, ou `null` quando nenhuma está.
   *
   * O Router cancela uma navegação em curso quando outra chega, e roda o
   * `canDeactivate` de novo — então o botão físico do Android, um duplo
   * toque no header ou o voltar do navegador em sequência chamam
   * `aoVoltar()` mais de uma vez antes da primeira responder. Sem esta
   * trava, a segunda chamada abriria um SEGUNDO alerta por cima do primeiro;
   * se os dois botões escolhidos divergissem ("Descartar" em cima,
   * "Continuar depois" embaixo), `salvarRascunho()` rodaria DEPOIS do
   * `reset()` do descarte e recriaria um imóvel "Captura em andamento" vazio
   * — o registro fantasma que o comentário de `descartarRascunho()` existe
   * para evitar.
   *
   * Não é `async` de propósito: `return this.decisaoDeSaida;` precisa
   * devolver o MESMO objeto de promise para o segundo chamador, e uma função
   * `async` sempre embrulha o que ela devolve numa promise nova.
   */
  private decisaoDeSaida: Promise<boolean> | null = null;

  /**
   * Decide se dá para sair do wizard. Devolve `true` para deixar a navegação
   * seguir, `false` para ficar.
   *
   * Chamado pelo `tourWizardLeaveGuard` (`CanDeactivate` da rota `tour/novo`),
   * não por um `@Output` do `app-header`: o header é compartilhado por toda a
   * tela (§7 do SPRINT-3-TOUR-WIZARD.md, "consumido como está") e ele mesmo
   * navega com `backHref` — não emite evento. Um guard de rota, além de
   * cobrir o clique no header, intercepta o voltar do NAVEGADOR e o botão
   * FÍSICO do Android, os dois casos do chamado original que um `@Output` no
   * header nunca veria.
   */
  aoVoltar(): Promise<boolean> {
    if (this.decisaoDeSaida) return this.decisaoDeSaida;

    const decisao = this.decidirSaida();
    this.decisaoDeSaida = decisao;
    void decisao.finally(() => {
      if (this.decisaoDeSaida === decisao) this.decisaoDeSaida = null;
    });
    return decisao;
  }

  /**
   * Sem cômodo nenhum não há o que perguntar. E depois de publicado também
   * não: o tour já está no ar, e oferecer "descartar" ali apagaria um imóvel
   * que deixou de ser rascunho.
   */
  private decidirSaida(): Promise<boolean> {
    if (this.store.published() || !this.store.readyScenes().length) {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve) => {
      void this.alertController
        .create({
          header: this.translate.instant('TOUR_WIZARD.COMMON.LEAVE_TITLE'),
          message: this.translate.instant('TOUR_WIZARD.COMMON.LEAVE_MESSAGE'),
          // Sem escolha explícita a promise nunca resolveria, e o guard
          // ficaria pendurado — por isso o toque fora do alerta não conta
          // como resposta.
          backdropDismiss: false,
          buttons: [
            {
              text: this.translate.instant('TOUR_WIZARD.COMMON.LEAVE_CANCEL'),
              role: 'cancel',
              handler: () => resolve(false),
            },
            {
              text: this.translate.instant('TOUR_WIZARD.COMMON.LEAVE_DISCARD'),
              role: 'destructive',
              handler: () => {
                void this.store
                  .descartarRascunho()
                  .catch(() => undefined)
                  .then(() => resolve(true));
              },
            },
            {
              text: this.translate.instant('TOUR_WIZARD.COMMON.LEAVE_KEEP'),
              handler: () => {
                // A única das três portas em que o corretor PEDIU para salvar —
                // e o alerta que ele acabou de ler afirma que está guardado.
                //
                // Antes: `.catch(() => undefined)` e sai. A rede caía e ele
                // saía acreditando, sem os nomes, os hotspots e as conexões.
                // As fotos e o tratamento por IA de fato estão salvos — eles
                // sobem durante a captura —, mas o resto é exatamente o que
                // esta funcionalidade existe para guardar.
                //
                // Sair continua sendo opção dele; prender alguém no wizard
                // porque a rede caiu é pior. O que deixa de existir é sair sem
                // saber.
                void this.store.salvarRascunho().then(
                  () => resolve(true),
                  () => void this.avisarQueNaoSalvou().then(resolve),
                );
              },
            },
          ],
        })
        .then((alerta) => alerta.present())
        // Mesma regra de "sair não pode travar" que já vale para a rede,
        // acima: se o próprio `create()`/`present()` falhar (raro, mas
        // existe — overlay sem host, por exemplo), sem isto a promise nunca
        // resolveria e a pessoa não conseguiria mais sair do wizard, nunca.
        .catch(() => resolve(true));
    });
  }
}

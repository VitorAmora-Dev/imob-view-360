import { Component, DestroyRef, ViewChild, inject } from '@angular/core';
import { AlertController, IonContent } from '@ionic/angular/standalone';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AppHeaderComponent } from '../components/app-header/app-header.component';
import { TourPublishedComponent } from './published/tour-published.component';
import { StepHotspotsComponent } from './steps/step-hotspots/step-hotspots.component';
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
    StepHotspotsComponent,
    StepInfoComponent,
    TourPublishedComponent,
  ],
})
export class TourWizardPage {
  readonly store = inject(TourDraftStore);

  @ViewChild(AppHeaderComponent) private header?: AppHeaderComponent;

  private readonly alertController = inject(AlertController);
  private readonly translate = inject(TranslateService);

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
                // Falhar aqui não pode prender ninguém na tela: as fotos e o
                // tratamento por IA já estão no servidor, e o que se perde é
                // a edição da última etapa. Segurar alguém dentro do wizard
                // porque a rede caiu é pior.
                void this.store
                  .salvarRascunho()
                  .catch(() => undefined)
                  .then(() => resolve(true));
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

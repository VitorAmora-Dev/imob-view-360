import { Component, ViewChild, inject } from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { AppHeaderComponent } from '../components/app-header/app-header.component';
import { TourPublishedComponent } from './published/tour-published.component';
import { StepHotspotsComponent } from './steps/step-hotspots/step-hotspots.component';
import { StepImagesComponent } from './steps/step-images/step-images.component';
import { StepInfoComponent } from './steps/step-info/step-info.component';
import { TourDraftStore } from './tour-draft.store';
import { WizardStep } from './tour-wizard.model';

/**
 * Shell do wizard de criação de tour: topbar, stepper, progresso, corpo da
 * etapa e barra de ação.
 *
 * DONO: Frente A. Commit-zero — o esqueleto navega de ponta a ponta; o acabamento
 * do stepper e da barra de ação são as tarefas A2 e A3.
 *
 * A ação primária fica SEMPRE no rodapé, no desktop e no mobile. O progresso é
 * indicador de estado, não comando, e a ação tem que vir depois do conteúdo que
 * a confirma — por isso nada de botão junto à barra de progresso.
 *
 * O `TourDraftStore` é fornecido aqui, e não em `root`: o rascunho morre com a
 * tela (não há persistência — ver §2.3 do plano do sprint).
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
    StepImagesComponent,
    StepHotspotsComponent,
    StepInfoComponent,
    TourPublishedComponent,
  ],
})
export class TourWizardPage {
  readonly store = inject(TourDraftStore);
  readonly steps: WizardStep[] = [1, 2, 3];

  @ViewChild(AppHeaderComponent) private header?: AppHeaderComponent;

  /** O header encolhe com o scroll e depende do container do ion-content. */
  onScroll(event: CustomEvent<{ scrollTop: number }>): void {
    this.header?.onContentScroll(event.detail.scrollTop);
  }

  /** Rótulo do botão primário: "Publicar tour" fecha o fluxo na última etapa. */
  get primaryLabelKey(): string {
    return this.store.step() === 3
      ? 'TOUR_WIZARD.COMMON.PUBLISH'
      : 'TOUR_WIZARD.COMMON.NEXT';
  }

  /**
   * "Pular" só existe na etapa 2, e só enquanto o ambiente não tem nenhum
   * ponto: com um ponto criado, pular deixa de ser a saída óbvia e o botão
   * vira ruído ao lado de "Próximo".
   */
  get showSkip(): boolean {
    return (
      this.store.step() === 2 &&
      (this.store.selectedScene()?.hotspots.length ?? 0) === 0
    );
  }
}

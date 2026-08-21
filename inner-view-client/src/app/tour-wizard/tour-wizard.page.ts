import { Component, ViewChild, inject } from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { AppHeaderComponent } from '../components/app-header/app-header.component';
import { OwlLoaderComponent } from '../components/owl-loader/owl-loader.component';
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
    OwlLoaderComponent,
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

  /** O header encolhe com o scroll e depende do container do ion-content. */
  onScroll(event: CustomEvent<{ scrollTop: number }>): void {
    this.header?.onContentScroll(event.detail.scrollTop);
  }
}

import { Component, input, output } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import { codeSlashOutline, pencilOutline, trashOutline } from 'ionicons/icons';

/**
 * Ações do tour no alcance do polegar.
 *
 * A barra só comunica intenção: editar, incorporar e confirmar a exclusão são
 * decisões do shell e dos sheets, nunca efeitos executados por este componente.
 */
@Component({
  selector: 'app-tour-actions-bar',
  standalone: true,
  imports: [IonIcon, TranslatePipe],
  templateUrl: './tour-actions-bar.component.html',
  styleUrls: ['./tour-actions-bar.component.scss'],
  host: {
    '[class.is-hidden]': '!chromeVisible()',
  },
})
export class TourActionsBarComponent {
  readonly canEdit = input.required<boolean>();
  readonly hasScenes = input.required<boolean>();
  readonly chromeVisible = input.required<boolean>();

  readonly editRequested = output<void>();
  readonly embedRequested = output<void>();
  readonly deleteRequested = output<void>();

  constructor() {
    addIcons({ pencilOutline, codeSlashOutline, trashOutline });
  }
}

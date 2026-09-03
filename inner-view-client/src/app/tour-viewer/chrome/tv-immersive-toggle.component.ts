import { Component, computed, input, output } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import { eyeOffOutline, eyeOutline } from 'ionicons/icons';

/** Único controle de visualização: alterna o chrome sem persistir o estado. */
@Component({
  selector: 'app-tv-immersive-toggle',
  standalone: true,
  imports: [IonIcon, TranslatePipe],
  templateUrl: './tv-immersive-toggle.component.html',
  styleUrls: ['./tv-immersive-toggle.component.scss'],
})
export class TvImmersiveToggleComponent {
  readonly chromeVisible = input.required<boolean>();
  readonly toggled = output<void>();

  readonly labelKey = computed(() =>
    this.chromeVisible() ? 'TOUR_VIEWER.HIDE_UI' : 'TOUR_VIEWER.SHOW_UI',
  );

  constructor() {
    addIcons({ eyeOutline, eyeOffOutline });
  }
}

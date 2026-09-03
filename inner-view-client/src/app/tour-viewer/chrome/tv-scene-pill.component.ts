import { Component, input, output } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import { chevronDownOutline } from 'ionicons/icons';

/** Contexto da cena atual e porta de entrada para o sheet de cenas. */
@Component({
  selector: 'app-tv-scene-pill',
  standalone: true,
  imports: [IonIcon, TranslatePipe],
  templateUrl: './tv-scene-pill.component.html',
  styleUrls: ['./tv-scene-pill.component.scss'],
})
export class TvScenePillComponent {
  readonly sceneName = input.required<string>();
  readonly chromeVisible = input.required<boolean>();

  readonly openScenes = output<void>();

  constructor() {
    addIcons({ chevronDownOutline });
  }
}

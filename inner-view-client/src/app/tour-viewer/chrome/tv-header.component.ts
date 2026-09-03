import { Component, input, output } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import { chevronBackOutline } from 'ionicons/icons';

/** Cabeçalho móvel sobre o panorama. Só o botão de voltar sobrevive ao imersivo. */
@Component({
  selector: 'app-tv-header',
  standalone: true,
  imports: [IonIcon, TranslatePipe],
  templateUrl: './tv-header.component.html',
  styleUrls: ['./tv-header.component.scss'],
})
export class TvHeaderComponent {
  readonly tourName = input.required<string>();
  readonly sceneCount = input.required<number>();
  readonly chromeVisible = input.required<boolean>();

  readonly back = output<void>();
  readonly manage = output<void>();

  constructor() {
    addIcons({ chevronBackOutline });
  }
}

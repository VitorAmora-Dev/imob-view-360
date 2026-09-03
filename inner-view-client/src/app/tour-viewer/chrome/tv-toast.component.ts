import { Component, input } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import { checkmarkOutline } from 'ionicons/icons';

/** Confirmação efêmera controlada pelo timer de 2200 ms do store. */
@Component({
  selector: 'app-tv-toast',
  standalone: true,
  imports: [IonIcon, TranslatePipe],
  templateUrl: './tv-toast.component.html',
  styleUrls: ['./tv-toast.component.scss'],
})
export class TvToastComponent {
  readonly messageKey = input.required<string>();

  constructor() {
    addIcons({ checkmarkOutline });
  }
}

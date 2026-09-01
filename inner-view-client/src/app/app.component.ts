import { Component } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';

import { TabBarComponent } from './components/tab-bar/tab-bar.component';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  imports: [IonApp, IonRouterOutlet, TabBarComponent],
})
export class AppComponent {
  constructor() {}
}

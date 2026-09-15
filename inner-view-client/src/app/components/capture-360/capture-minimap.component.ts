import { AfterViewInit, Component, ElementRef, ViewChild, input } from '@angular/core';
import { CaptureTarget } from './capture-pattern';

/**
 * Visão de cima da volta de captura.
 *
 * Os pontos vêm do mesmo plano usado pela sessão; só a rotação acompanha o
 * sensor a 60 fps, por escrita direta no DOM, sem disparar change detection.
 */
@Component({
  selector: 'app-capture-minimap',
  standalone: true,
  templateUrl: './capture-minimap.component.html',
  styleUrls: ['./capture-minimap.component.scss'],
})
export class CaptureMinimapComponent implements AfterViewInit {
  @ViewChild('rotor') private rotor?: ElementRef<HTMLElement>;

  readonly targets = input<readonly CaptureTarget[]>([]);
  readonly capturedCount = input(0);
  private headingDeg = 0;

  ngAfterViewInit(): void {
    this.paintHeading(this.headingDeg);
  }

  paintHeading(yawDeg: number): void {
    if (!Number.isFinite(yawDeg)) return;
    this.headingDeg = yawDeg;
    if (this.rotor) {
      this.rotor.nativeElement.style.transform = `rotate(${-yawDeg}deg)`;
    }
  }
}

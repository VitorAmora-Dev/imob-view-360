import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, ViewChild, input, output, signal } from '@angular/core';
import { IonButton, IonIcon } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import { play, refreshOutline } from 'ionicons/icons';

@Component({
  selector: 'app-capture-intro',
  standalone: true,
  imports: [IonButton, IonIcon, TranslatePipe],
  templateUrl: './capture-intro.component.html',
  styleUrls: ['./capture-intro.component.scss'],
})
export class CaptureIntroComponent implements AfterViewInit, OnDestroy {
  @ViewChild('tutorial') tutorial?: ElementRef<HTMLVideoElement>;

  readonly starting = input(false);
  readonly startRequested = output<void>();
  readonly cancelRequested = output<void>();
  readonly hasStarted = signal(false);
  readonly ended = signal(false);
  readonly playRequired = signal(false);
  readonly videoFailed = signal(false);
  readonly autoplayEnabled = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  private destroyed = false;

  constructor() {
    addIcons({ play, refreshOutline });
  }

  ngAfterViewInit(): void {
    // Depois da primeira renderização para não alterar bindings durante o
    // mesmo ciclo em que o elemento de vídeo nasce.
    queueMicrotask(() => {
      if (this.destroyed) return;
      if (this.autoplayEnabled) this.playTutorial();
      else this.playRequired.set(true);
    });
  }

  playTutorial(): void {
    const video = this.tutorial?.nativeElement;
    if (!video || this.starting()) return;
    if (this.ended()) video.currentTime = 0;
    this.ended.set(false);
    this.playRequired.set(false);
    this.hasStarted.set(true);
    void video.play().catch((error: DOMException) => {
      // Pausar ao sair também rejeita uma reprodução ainda carregando.
      if (this.destroyed || this.starting() || error.name === 'AbortError') return;
      if (error.name === 'NotAllowedError') {
        this.hasStarted.set(false);
        this.playRequired.set(true);
        return;
      }
      this.videoFailed.set(true);
    });
  }

  onPlay(): void {
    this.ended.set(false);
    this.playRequired.set(false);
    this.hasStarted.set(true);
  }

  begin(): void {
    if (this.starting()) return;
    this.pauseVideo();
    // Emissão síncrona: o iOS exige o gesto para pedir acesso ao giroscópio.
    this.startRequested.emit();
  }

  dismiss(): void {
    this.pauseVideo();
    this.cancelRequested.emit();
  }

  @HostListener('document:visibilitychange')
  onVisibilityChange(): void {
    if (document.hidden) this.pauseVideo();
  }

  private pauseVideo(): void {
    this.tutorial?.nativeElement.pause();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    const video = this.tutorial?.nativeElement;
    if (!video) return;
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}

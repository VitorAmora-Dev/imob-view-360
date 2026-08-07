import { RealCameraSource } from './capture-sources';

/**
 * The preview survives being moved from one container to another.
 *
 * The capture screen replaces the lens screen, and both host the same `<video>`
 * element, so every capture re-parents it. The HTML specification says that
 * removing a media element from the document queues a task which pauses it —
 * and only skips the pause if the element is back in a document by the time
 * that task runs. Angular destroys the old view and creates the new one across
 * a task boundary, so the race is real and it is lost most of the time: the
 * capture screen came up black with only the guidance dots on it, about seven
 * attempts in ten, and reloading the page was the only way through.
 */
describe('camera preview across a container change', () => {
  let painter: number | null = null;
  let canvas: HTMLCanvasElement;
  let containers: HTMLElement[] = [];

  /** A real MediaStream without a camera: a canvas that keeps repainting. */
  function fakeCameraStream(): MediaStream {
    canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const ctx = canvas.getContext('2d')!;
    let tick = 0;
    const paint = () => {
      ctx.fillStyle = tick++ % 2 ? '#123' : '#456';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };
    paint();
    painter = setInterval(paint, 30) as unknown as number;
    return canvas.captureStream(30);
  }

  function container(): HTMLElement {
    const element = document.createElement('div');
    document.body.appendChild(element);
    containers.push(element);
    return element;
  }

  /** Lets the task queue drain, which is where the specified pause happens. */
  const nextTask = () => new Promise((resolve) => setTimeout(resolve));

  let source: RealCameraSource;
  let originalMedia: MediaDevices;

  beforeEach(async () => {
    localStorage.removeItem('capture360.lensId');
    const stream = fakeCameraStream();
    originalMedia = navigator.mediaDevices;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () => Promise.resolve(stream),
        enumerateDevices: () =>
          Promise.resolve([{ kind: 'videoinput', deviceId: 'back', label: 'Back Camera' }]),
      },
    });
    source = new RealCameraSource();
    await source.start();
  });

  afterEach(() => {
    source.stop();
    if (painter !== null) clearInterval(painter);
    painter = null;
    containers.forEach((c) => c.remove());
    containers = [];
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: originalMedia,
    });
  });

  it('is playing once attached', async () => {
    const host = container();
    source.attach(host);
    await nextTask();
    const video = host.querySelector('video')!;
    expect(video).withContext('no video element was attached').toBeTruthy();
    expect(video.paused).withContext('the preview never started').toBeFalse();
  });

  /**
   * The exact sequence the capture screen performs: the old view is destroyed,
   * a task boundary passes, then the new view claims the preview.
   */
  it('keeps playing when the old container is destroyed before the new one exists', async () => {
    const lensStep = container();
    source.attach(lensStep);
    await nextTask();

    lensStep.remove();
    await nextTask();

    const captureStep = container();
    source.attach(captureStep);
    await nextTask();

    const video = captureStep.querySelector('video')!;
    expect(video).withContext('the preview did not follow the container').toBeTruthy();
    expect(video.paused)
      .withContext('the preview came up paused — this is the black capture screen')
      .toBeFalse();
  });

  it('keeps playing when the preview moves straight between containers', async () => {
    const first = container();
    source.attach(first);
    await nextTask();

    const second = container();
    source.attach(second);
    await nextTask();

    expect(first.querySelector('video')).toBeNull();
    expect(second.querySelector('video')!.paused).toBeFalse();
  });
});

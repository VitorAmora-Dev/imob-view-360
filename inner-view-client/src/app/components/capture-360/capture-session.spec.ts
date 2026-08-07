import { CaptureSession, SessionEvent, separationDeg } from './capture-session';
import { CaptureTarget } from './capture-pattern';

function ring(count: number, pitchDeg = 0): CaptureTarget[] {
  return Array.from({ length: count }, (_, i) => ({
    yawDeg: (i * 360) / count,
    pitchDeg,
  }));
}

describe('CaptureSession', () => {
  /** Feeds identical samples for `ms`, stepping like a 20Hz sensor. */
  function hold(
    session: CaptureSession,
    clock: { now: number },
    yawDeg: number,
    ms: number,
    pitchDeg = 0,
  ): SessionEvent[] {
    const events: SessionEvent[] = [];
    const end = clock.now + ms;
    while (clock.now < end) {
      clock.now += 50;
      events.push(...session.update(clock.now, { yawDeg, pitchDeg, rollDeg: 0 }));
    }
    return events;
  }

  function makeSession(targets = ring(12)): { session: CaptureSession; clock: { now: number } } {
    return { session: new CaptureSession(targets, { dwellMs: 500 }), clock: { now: 0 } };
  }

  /**
   * The aim tolerance has to mean the same thing everywhere on the sphere.
   * Yaw compresses towards the poles, so a box in yaw and pitch would make the
   * upward cap — aimed at 70°, the hardest shot of the capture — roughly three
   * times stricter than every shot on the ring.
   */
  it('asks for the same real accuracy on the ring and on the cap', () => {
    const upward = ring(3, 70);
    const { session, clock } = makeSession(upward);

    // 4° of yaw off a target at 70° is only 1.4° of actual movement: well
    // inside a 5° tolerance, and something a box test would have rejected at
    // 4° of yaw plus any pitch error at all.
    expect(separationDeg({ yawDeg: 0, pitchDeg: 70 }, { yawDeg: 4, pitchDeg: 70 })).toBeLessThan(2);

    const events = hold(session, clock, 4, 1500, 70);
    expect(events.some((e) => e.type === 'capture')).toBeTrue();
  });

  it('still refuses an aim that is genuinely too far off', () => {
    const { session, clock } = makeSession();
    const events = hold(session, clock, 9, 1500);
    expect(events.some((e) => e.type === 'capture')).toBeFalse();
  });

  it('captures a target after holding steady inside it for the dwell time', () => {
    const { session, clock } = makeSession();
    const events = hold(session, clock, 0, 1500);
    expect(events.some((e) => e.type === 'capture' && e.targetIndex === 0)).toBeTrue();
    expect(session.snapshot.capturedCount).toBe(1);
  });

  it('does not start the dwell while the phone is sweeping fast', () => {
    const { session, clock } = makeSession();
    let yaw = -20;
    const events: SessionEvent[] = [];
    for (let i = 0; i < 20; i++) {
      clock.now += 50;
      yaw += 2; // 40°/s
      events.push(...session.update(clock.now, { yawDeg: yaw, pitchDeg: 0, rollDeg: 0 }));
    }
    expect(events.length).toBe(0);
  });

  it('restarts the dwell from zero when the reticle drifts out mid-hold', () => {
    const { session, clock } = makeSession();
    hold(session, clock, 0, 300);
    hold(session, clock, 15, 200); // out of the ±5° tolerance
    expect(session.snapshot.capturedCount).toBe(0);
    expect(session.snapshot.dwellProgress).toBe(0);

    expect(hold(session, clock, 0, 1500).some((e) => e.type === 'capture')).toBeTrue();
  });

  it('rejects a shot aimed at the right yaw but the wrong pitch', () => {
    const { session, clock } = makeSession();
    expect(hold(session, clock, 0, 1500, 20).length).toBe(0);
    expect(hold(session, clock, 0, 1500, 0).some((e) => e.type === 'capture')).toBeTrue();
  });

  it('walks a full ring and completes after the last target', () => {
    const targets = ring(8);
    const { session, clock } = makeSession(targets);
    const all: SessionEvent[] = [];
    for (const t of targets) all.push(...hold(session, clock, t.yawDeg, 2500));

    expect(all.filter((e) => e.type === 'capture').length).toBe(8);
    expect(all.some((e) => e.type === 'complete')).toBeTrue();
    expect(session.snapshot.status).toBe('complete');
  });

  it('reports where the next target sits relative to the reticle', () => {
    const { session, clock } = makeSession();
    hold(session, clock, 0, 1500); // capture target 0 → next is 30°
    clock.now += 50;
    session.update(clock.now, { yawDeg: 10, pitchDeg: 4, rollDeg: 0 });
    expect(session.snapshot.currentTarget.yawDeg).toBe(30);
    expect(session.snapshot.offsetYawDeg).toBeCloseTo(20, 5);
    expect(session.snapshot.offsetPitchDeg).toBeCloseTo(-4, 5);
  });

  it('reset clears captures and dwell state', () => {
    const { session, clock } = makeSession();
    hold(session, clock, 0, 1500);
    expect(session.snapshot.capturedCount).toBe(1);
    session.reset();
    expect(session.snapshot.capturedCount).toBe(0);
    expect(session.snapshot.status).toBe('seeking');
  });
});

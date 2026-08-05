import { CaptureSession, SessionEvent, targetCountForHfov } from './capture-session';

describe('targetCountForHfov', () => {
  it('keeps the BANIB-style 12 dots for a 4:3 portrait camera (~51° hfov)', () => {
    expect(targetCountForHfov(51, { centerToleranceDeg: 5 })).toBe(12);
  });

  it('adds dots for narrow 16:9 portrait cameras so shots always overlap', () => {
    expect(targetCountForHfov(39.4, { centerToleranceDeg: 5 })).toBeGreaterThan(12);
  });
});

describe('CaptureSession', () => {
  /** Feeds identical samples for `ms`, stepping like a 20Hz sensor. */
  function hold(
    session: CaptureSession,
    clock: { now: number },
    yawDeg: number,
    ms: number,
  ): SessionEvent[] {
    const events: SessionEvent[] = [];
    const end = clock.now + ms;
    while (clock.now < end) {
      clock.now += 50;
      events.push(...session.update(clock.now, { yawDeg, pitchDeg: 0, rollDeg: 0 }));
    }
    return events;
  }

  function makeSession(): { session: CaptureSession; clock: { now: number } } {
    return {
      session: new CaptureSession({ targetCount: 12, dwellMs: 500 }),
      clock: { now: 0 },
    };
  }

  it('captures a target after holding steady inside it for the dwell time', () => {
    const { session, clock } = makeSession();
    const events = hold(session, clock, 0, 1500);
    expect(events.some((e) => e.type === 'capture' && e.targetIndex === 0)).toBeTrue();
    expect(session.snapshot.capturedCount).toBe(1);
  });

  it('does not start the dwell while the phone is sweeping fast', () => {
    const { session, clock } = makeSession();
    // 40°/s sweep across the first target: never settles.
    let yaw = -20;
    const events: SessionEvent[] = [];
    for (let i = 0; i < 20; i++) {
      clock.now += 50;
      yaw += 2;
      events.push(...session.update(clock.now, { yawDeg: yaw, pitchDeg: 0, rollDeg: 0 }));
    }
    expect(events.length).toBe(0);
  });

  it('restarts the dwell from zero when the reticle drifts out mid-hold', () => {
    const { session, clock } = makeSession();
    hold(session, clock, 0, 300); // partial dwell
    hold(session, clock, 15, 200); // drift away — out of ±5° tolerance
    expect(session.snapshot.capturedCount).toBe(0);
    expect(session.snapshot.dwellProgress).toBe(0);

    // Coming back needs the full dwell again (allow settle time after the jump).
    const events = hold(session, clock, 0, 1500);
    expect(events.some((e) => e.type === 'capture')).toBeTrue();
  });

  it('walks the full ring and completes after the last target', () => {
    const { session, clock } = makeSession();
    const targets = session.targetYaws();
    expect(targets.length).toBe(12);

    const all: SessionEvent[] = [];
    for (const yaw of targets) {
      all.push(...hold(session, clock, yaw, 2500));
    }

    const captures = all.filter((e) => e.type === 'capture');
    expect(captures.length).toBe(12);
    expect(captures.map((c) => (c.type === 'capture' ? c.targetIndex : -1)))
      .toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(all.some((e) => e.type === 'complete')).toBeTrue();
    expect(session.snapshot.status).toBe('complete');
  });

  it('reports where the next target sits relative to the reticle', () => {
    const { session, clock } = makeSession();
    hold(session, clock, 0, 1500); // capture target 0 → next is 30°
    clock.now += 50;
    session.update(clock.now, { yawDeg: 10, pitchDeg: 4, rollDeg: 0 });
    expect(session.snapshot.currentTargetYawDeg).toBe(30);
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

import { buildCapturePlan, TOTAL_STEPS } from './capture-plan';

describe('capture-plan', () => {
  const steps = buildCapturePlan();

  it('gera 18 passos: 8 superior, 8 inferior, zênite, nadir', () => {
    expect(steps.length).toBe(18);
    expect(TOTAL_STEPS).toBe(18);
    expect(steps.slice(0, 8).every((s) => s.kind === 'band' && s.band === 'upper')).toBeTrue();
    expect(steps.slice(8, 16).every((s) => s.kind === 'band' && s.band === 'lower')).toBeTrue();
    expect(steps[16].pole).toBe('zenith');
    expect(steps[17].pole).toBe('nadir');
  });

  it('usa visor de gomo nas faixas e disco nos polos', () => {
    expect(steps.slice(0, 16).every((s) => s.viewfinder === 'gore')).toBeTrue();
    expect(steps[16].viewfinder).toBe('disc');
    expect(steps[17].viewfinder).toBe('disc');
  });

  it('define o pitch da câmera por passo (±20° faixas, ±90° polos)', () => {
    expect(steps[0].pitchDeg).toBe(20);
    expect(steps[8].pitchDeg).toBe(-20);
    expect(steps[16].pitchDeg).toBe(90);
    expect(steps[17].pitchDeg).toBe(-90);
  });

  it('instrui inclinar no início de cada faixa e girar no resto', () => {
    expect(steps[0].instructionKey).toContain('TILT_UP');
    expect(steps[1].instructionKey).toContain('TURN');
    expect(steps[8].instructionKey).toContain('TILT_DOWN');
    expect(steps[9].instructionKey).toContain('TURN');
    expect(steps[16].instructionKey).toContain('POINT_UP');
    expect(steps[17].instructionKey).toContain('POINT_DOWN');
  });

  it('tem chaves únicas', () => {
    const keys = steps.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(steps[3].key).toBe('upper:3');
    expect(steps[11].key).toBe('lower:3');
  });
});

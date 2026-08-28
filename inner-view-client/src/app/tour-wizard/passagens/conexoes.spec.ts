import { WizardHotspot, WizardScene } from '../tour-wizard.model';
import { conexoesParaServidor, conexoesRetomadas } from './conexoes';

function ponto(id: string, target: string | null): WizardHotspot {
  return { id, u: 0.5, v: 0.5, label: '', target };
}

function cena(
  id: string,
  extra: Partial<WizardScene> = {},
): WizardScene {
  return {
    id,
    room: id,
    fileName: `${id}.jpg`,
    fileSize: 1024,
    imageData: '',
    order: 0,
    hotspots: [],
    state: 'ready',
    ...extra,
  };
}

function conexoesDe(cenas: WizardScene[], id: string): string[] {
  return cenas.find((s) => s.id === id)?.connections ?? [];
}

describe('conexoesParaServidor', () => {
  it('traduz id local para id de panorama, na ordem da escolha', () => {
    const sala = cena('sala', { connections: ['quarto', 'cozinha'] });
    const mapa = new Map([
      ['sala', 'p-sala'],
      ['cozinha', 'p-cozinha'],
      ['quarto', 'p-quarto'],
    ]);

    expect(conexoesParaServidor(sala, mapa)).toEqual(['p-quarto', 'p-cozinha']);
  });

  /**
   * Gravar o uuid local seria pior do que não gravar: o servidor aceitaria, e a
   * retomada devolveria uma conexão para um cômodo que nunca existiu do lado
   * de lá. A perda é temporária — `connections` continua inteiro em memória, e
   * o salvamento seguinte manda a lista de novo já com o id que faltava.
   */
  it('descarta ambiente que ainda não tem panorama no servidor', () => {
    const sala = cena('sala', { connections: ['cozinha', 'quarto'] });
    const mapa = new Map<string, string | undefined>([
      ['sala', 'p-sala'],
      ['cozinha', undefined],
      ['quarto', 'p-quarto'],
    ]);

    expect(conexoesParaServidor(sala, mapa)).toEqual(['p-quarto']);
  });

  it('cena sem conexão nenhuma manda lista vazia', () => {
    expect(conexoesParaServidor(cena('sala'), new Map())).toEqual([]);
  });
});

describe('conexoesRetomadas', () => {
  const sala = () => cena('sala', { serverPanoramaId: 'p-sala' });
  const cozinha = () => cena('cozinha', { serverPanoramaId: 'p-cozinha' });
  const quarto = () => cena('quarto', { serverPanoramaId: 'p-quarto' });

  it('traduz os ids de panorama guardados de volta para ids locais', () => {
    const cenas = conexoesRetomadas(
      [sala(), cozinha()],
      new Map([
        ['p-sala', ['p-cozinha']],
        ['p-cozinha', ['p-sala']],
      ]),
    );

    expect(conexoesDe(cenas, 'sala')).toEqual(['cozinha']);
    expect(conexoesDe(cenas, 'cozinha')).toEqual(['sala']);
  });

  /**
   * O índice do array é a ordem de trabalho da etapa de passagens. Se a
   * recíproca da Sala entrasse na Cozinha antes do que a própria Cozinha
   * guardou, o corretor retomaria com a fila em outra sequência.
   */
  it('preserva a ordem que cada ambiente guardou', () => {
    const cenas = conexoesRetomadas(
      [sala(), cozinha(), quarto()],
      new Map([
        ['p-sala', ['p-cozinha']],
        ['p-cozinha', ['p-quarto', 'p-sala']],
        ['p-quarto', ['p-cozinha']],
      ]),
    );

    expect(conexoesDe(cenas, 'cozinha')).toEqual(['quarto', 'sala']);
  });

  /**
   * Um rascunho gravado antes da coluna `draftConnections` existir tem os
   * pontos e não tem a coluna. Sem esta dedução ele voltaria com a etapa de
   * passagens dizendo que não há nada a fazer, ao lado de pontos já marcados.
   */
  it('deduz a conexão dos pontos já posicionados quando nada foi guardado', () => {
    const cenas = conexoesRetomadas(
      [
        cena('sala', {
          serverPanoramaId: 'p-sala',
          hotspots: [ponto('h1', 'cozinha')],
        }),
        cozinha(),
      ],
      new Map(),
    );

    expect(conexoesDe(cenas, 'sala')).toEqual(['cozinha']);
    expect(conexoesDe(cenas, 'cozinha')).toEqual(['sala']);
  });

  it('não duplica quando o ponto confirma o que já estava guardado', () => {
    const cenas = conexoesRetomadas(
      [
        cena('sala', {
          serverPanoramaId: 'p-sala',
          hotspots: [ponto('h1', 'cozinha')],
        }),
        cozinha(),
      ],
      new Map([
        ['p-sala', ['p-cozinha']],
        ['p-cozinha', ['p-sala']],
      ]),
    );

    expect(conexoesDe(cenas, 'sala')).toEqual(['cozinha']);
    expect(conexoesDe(cenas, 'cozinha')).toEqual(['sala']);
  });

  /**
   * `ligar` é simétrico do lado do wizard, mas o que chega aqui veio do banco —
   * e ali um `DELETE` interrompido, ou uma gravação que só metade subiu, deixa
   * um lado sem o outro. O resumo "conecta com Cozinha" mentiria para um dos
   * cards.
   */
  it('completa a recíproca que faltou no que veio do servidor', () => {
    const cenas = conexoesRetomadas(
      [sala(), cozinha()],
      new Map([['p-sala', ['p-cozinha']]]),
    );

    expect(conexoesDe(cenas, 'cozinha')).toEqual(['sala']);
  });

  it('descarta conexão para ambiente que não veio no rascunho', () => {
    const cenas = conexoesRetomadas(
      [sala()],
      new Map([['p-sala', ['p-cozinha']]]),
    );

    expect(conexoesDe(cenas, 'sala')).toEqual([]);
  });

  it('ignora cena que ainda não tem panorama no servidor', () => {
    const cenas = conexoesRetomadas(
      [cena('nova'), sala()],
      new Map([['p-sala', []]]),
    );

    expect(conexoesDe(cenas, 'nova')).toEqual([]);
    expect(conexoesDe(cenas, 'sala')).toEqual([]);
  });

  it('não perde os outros campos da cena', () => {
    const cenas = conexoesRetomadas([sala()], new Map());

    expect(cenas[0].serverPanoramaId).toBe('p-sala');
    expect(cenas[0].room).toBe('sala');
    expect(cenas.length).toBe(1);
  });
});

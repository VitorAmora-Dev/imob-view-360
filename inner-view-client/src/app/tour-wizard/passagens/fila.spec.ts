import { WizardHotspot, WizardScene } from '../tour-wizard.model';
import {
  desligar,
  filaDePassagens,
  ligar,
  pendentesDoAmbiente,
  primeiraPendente,
  resumoDeConexoes,
} from './fila';

function ponto(id: string, target: string | null): WizardHotspot {
  return { id, u: 0.5, v: 0.5, label: '', target };
}

function cena(
  id: string,
  connections?: string[],
  hotspots: WizardHotspot[] = [],
): WizardScene {
  return {
    id,
    room: id,
    fileName: `${id}.jpg`,
    fileSize: 1024,
    imageData: 'data:image/jpeg;base64,x',
    order: 0,
    hotspots,
    state: 'ready',
    ...(connections ? { connections } : {}),
  };
}

function conexoesDe(cenas: WizardScene[], id: string): string[] {
  return cenas.find((s) => s.id === id)?.connections ?? [];
}

describe('ligar', () => {
  // Simetrico porque a conexao e reciproca: "conecta com Cozinha" tem de ser
  // verdade nos DOIS cards, senao o resumo mente para um dos lados.
  it('escreve nos dois ambientes', () => {
    const cenas = ligar([cena('sala'), cena('cozinha')], 'sala', 'cozinha');

    expect(conexoesDe(cenas, 'sala')).toEqual(['cozinha']);
    expect(conexoesDe(cenas, 'cozinha')).toEqual(['sala']);
  });

  it('preserva a ordem de selecao', () => {
    let cenas = [cena('sala'), cena('cozinha'), cena('quarto')];
    cenas = ligar(cenas, 'sala', 'quarto');
    cenas = ligar(cenas, 'sala', 'cozinha');

    expect(conexoesDe(cenas, 'sala')).toEqual(['quarto', 'cozinha']);
  });

  // Ligar de novo o que ja esta ligado nao pode duplicar: o card da Cozinha
  // oferece a Sala mesmo quando a ligacao nasceu do lado da Sala.
  it('e idempotente', () => {
    let cenas = ligar([cena('sala'), cena('cozinha')], 'sala', 'cozinha');
    cenas = ligar(cenas, 'cozinha', 'sala');

    expect(conexoesDe(cenas, 'sala')).toEqual(['cozinha']);
    expect(conexoesDe(cenas, 'cozinha')).toEqual(['sala']);
  });

  it('nao liga um ambiente a si mesmo', () => {
    const cenas = ligar([cena('sala')], 'sala', 'sala');
    expect(conexoesDe(cenas, 'sala')).toEqual([]);
  });

  it('ignora id que nao existe', () => {
    const cenas = ligar([cena('sala')], 'sala', 'inexistente');
    expect(conexoesDe(cenas, 'sala')).toEqual([]);
  });
});

describe('desligar', () => {
  it('tira as duas pontas', () => {
    const ligadas = ligar([cena('sala'), cena('cozinha')], 'sala', 'cozinha');
    const { cenas } = desligar(ligadas, 'sala', 'cozinha');

    expect(conexoesDe(cenas, 'sala')).toEqual([]);
    expect(conexoesDe(cenas, 'cozinha')).toEqual([]);
  });

  // Quem chama precisa saber o que vai sumir para poder perguntar antes.
  it('devolve os pontos que serao perdidos, dos dois lados', () => {
    const cenas = [
      cena('sala', ['cozinha'], [ponto('h1', 'cozinha')]),
      cena('cozinha', ['sala'], [ponto('h2', 'sala')]),
    ];
    const { perdidos } = desligar(cenas, 'sala', 'cozinha');

    expect(perdidos.map((h) => h.id).sort()).toEqual(['h1', 'h2']);
  });

  it('apaga os hotspots junto com a conexao', () => {
    const antes = [
      cena('sala', ['cozinha'], [ponto('h1', 'cozinha'), ponto('h9', 'quarto')]),
      cena('cozinha', ['sala'], [ponto('h2', 'sala')]),
    ];
    const { cenas } = desligar(antes, 'sala', 'cozinha');

    expect(cenas[0].hotspots.map((h) => h.id)).toEqual(['h9']);
    expect(cenas[1].hotspots).toEqual([]);
  });

  it('sem ligacao nenhuma nao perde nada', () => {
    const { perdidos } = desligar(
      [cena('sala'), cena('cozinha')],
      'sala',
      'cozinha',
    );
    expect(perdidos).toEqual([]);
  });
});

describe('filaDePassagens', () => {
  // Agrupada por ambiente na ordem dos cards, e dentro do ambiente na ordem de
  // selecao. E isso que faz o corretor permanecer na mesma foto ate acabarem
  // os destinos daquele ambiente.
  it('agrupa por ambiente, na ordem dos cards', () => {
    const cenas = [
      cena('sala', ['cozinha', 'quarto']),
      cena('cozinha', ['sala']),
      cena('quarto', ['sala']),
    ];
    const fila = filaDePassagens(cenas);

    expect(fila.map((p) => `${p.origem.id}->${p.destino.id}`)).toEqual([
      'sala->cozinha',
      'sala->quarto',
      'cozinha->sala',
      'quarto->sala',
    ]);
  });

  it('marca como feita a passagem que ja tem ponto', () => {
    const cenas = [
      cena('sala', ['cozinha'], [ponto('h1', 'cozinha')]),
      cena('cozinha', ['sala']),
    ];
    const fila = filaDePassagens(cenas);

    expect(fila[0].feita).toBeTrue();
    expect(fila[1].feita).toBeFalse();
  });

  it('sem conexoes, a fila e vazia', () => {
    expect(filaDePassagens([cena('sala'), cena('cozinha')])).toEqual([]);
  });

  // Conexao apontando para ambiente que sumiu nao pode virar passagem: nao ha
  // foto de destino, e o painel nao teria nome para mostrar.
  it('descarta conexao para ambiente que nao existe mais', () => {
    const fila = filaDePassagens([cena('sala', ['fantasma'])]);
    expect(fila).toEqual([]);
  });

  it('so considera cenas prontas', () => {
    const recusada = { ...cena('quarto', ['sala']), state: 'rejected' as const };
    const fila = filaDePassagens([cena('sala', ['quarto']), recusada]);
    expect(fila).toEqual([]);
  });
});

describe('primeiraPendente', () => {
  it('acha a primeira sem ponto', () => {
    const cenas = [
      cena('sala', ['cozinha'], [ponto('h1', 'cozinha')]),
      cena('cozinha', ['sala']),
    ];
    expect(primeiraPendente(filaDePassagens(cenas))).toBe(1);
  });

  it('tudo feito devolve -1', () => {
    const cenas = [
      cena('sala', ['cozinha'], [ponto('h1', 'cozinha')]),
      cena('cozinha', ['sala'], [ponto('h2', 'sala')]),
    ];
    expect(primeiraPendente(filaDePassagens(cenas))).toBe(-1);
  });

  it('fila vazia devolve -1', () => {
    expect(primeiraPendente([])).toBe(-1);
  });
});

describe('pendentesDoAmbiente', () => {
  // A lista da gaveta: o que ainda falta NESTA foto, sem contar a que esta
  // sendo posicionada agora.
  it('lista as outras pendentes da mesma origem', () => {
    const cenas = [
      cena('sala', ['cozinha', 'quarto', 'banheiro']),
      cena('cozinha'),
      cena('quarto'),
      cena('banheiro'),
    ];
    const fila = filaDePassagens(cenas);

    expect(pendentesDoAmbiente(fila, 0).map((p) => p.destino.id)).toEqual([
      'quarto',
      'banheiro',
    ]);
  });

  it('nao mistura ambientes', () => {
    const cenas = [cena('sala', ['cozinha']), cena('cozinha', ['sala'])];
    const fila = filaDePassagens(cenas);

    expect(pendentesDoAmbiente(fila, 0)).toEqual([]);
  });

  it('indice fora da faixa devolve vazio', () => {
    expect(pendentesDoAmbiente([], 0)).toEqual([]);
  });
});

describe('resumoDeConexoes', () => {
  it('devolve os nomes na ordem de selecao', () => {
    const cenas = [
      cena('sala', ['quarto', 'cozinha']),
      cena('cozinha'),
      cena('quarto'),
    ];
    expect(resumoDeConexoes(cenas[0], cenas)).toEqual(['quarto', 'cozinha']);
  });

  it('sem conexoes devolve vazio', () => {
    expect(resumoDeConexoes(cena('sala'), [cena('sala')])).toEqual([]);
  });

  // Cena sem nome digitado cai no nome do arquivo, como no publicar.
  it('cai no nome do arquivo quando o ambiente nao tem nome', () => {
    const semNome = { ...cena('cozinha'), room: '   ' };
    const cenas = [cena('sala', ['cozinha']), semNome];
    expect(resumoDeConexoes(cenas[0], cenas)).toEqual(['cozinha.jpg']);
  });
});

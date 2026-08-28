import {
  ambientesIlhados,
  becosSemSaida,
  saidasEscolhidas,
} from './scene-graph';
import { WizardHotspot, WizardScene } from './tour-wizard.model';

/**
 * O grafo do tour.
 *
 * A regra que importa aqui não é "tem hotspot": é "o visitante chega lá". As
 * duas parecem a mesma coisa até o segundo ambiente, e é justamente onde a
 * primeira começa a mentir.
 */
describe('scene-graph', () => {
  function cena(
    id: string,
    destinos: (string | null)[] = [],
    state: WizardScene['state'] = 'ready',
  ): WizardScene {
    const hotspots: WizardHotspot[] = destinos.map((target, i) => ({
      id: `${id}-h${i}`,
      u: 0.5,
      v: 0.5,
      label: '',
      target,
    }));
    return {
      id,
      room: id.toUpperCase(),
      fileName: `${id}.jpg`,
      fileSize: 1024,
      imageData: 'data:image/jpeg;base64,x',
      order: 0,
      hotspots,
      state,
    };
  }

  const ids = (cenas: WizardScene[]) => cenas.map((s) => s.id);

  describe('ambientesIlhados', () => {
    it('não cobra ligação de quem só tem um ambiente', () => {
      // Sem segundo ambiente não há para onde ir, e um ponto ali não teria
      // destino possível.
      expect(ambientesIlhados([cena('a')])).toEqual([]);
    });

    it('acusa o tour de vários ambientes sem ligação nenhuma', () => {
      // O caso que motivou o arquivo: quatro ambientes publicados, um visível.
      const ilhados = ambientesIlhados([cena('a'), cena('b'), cena('c')]);

      expect(ids(ilhados)).toEqual(['b', 'c']);
    });

    it('um ponto só não salva um tour de cinco ambientes', () => {
      // A regra "pelo menos um hotspot" passaria aqui. É por isso que ela não
      // serve: liga dois e deixa três invisíveis.
      const ilhados = ambientesIlhados([
        cena('a', ['b']),
        cena('b'),
        cena('c'),
        cena('d'),
        cena('e'),
      ]);

      expect(ids(ilhados)).toEqual(['c', 'd', 'e']);
    });

    it('segue a corrente até o fim', () => {
      // a -> b -> c: `c` é alcançável mesmo sem ligação direta com o início.
      const ilhados = ambientesIlhados([
        cena('a', ['b']),
        cena('b', ['c']),
        cena('c'),
      ]);

      expect(ilhados).toEqual([]);
    });

    it('ligação que sai de um ambiente inalcançável não conta', () => {
      // `b` e `c` se apontam, mas ninguém chega em nenhum dos dois. Uma
      // contagem de arestas diria que está tudo ligado.
      const ilhados = ambientesIlhados([
        cena('a'),
        cena('b', ['c']),
        cena('c', ['b']),
      ]);

      expect(ids(ilhados)).toEqual(['b', 'c']);
    });

    it('ponto sem destino não liga nada', () => {
      // Órfão é descartado na publicação. Se contasse aqui, o wizard liberaria
      // um tour que o servidor recebe quebrado.
      const ilhados = ambientesIlhados([cena('a', [null]), cena('b')]);

      expect(ids(ilhados)).toEqual(['b']);
    });

    it('ponto para ambiente removido não liga nada', () => {
      // Mesma regra do payload: destino tem de existir E ter imagem.
      const ilhados = ambientesIlhados([cena('a', ['sumiu']), cena('b')]);

      expect(ids(ilhados)).toEqual(['b']);
    });

    it('ignora cena sem imagem, dos dois lados', () => {
      // Uma cena que ainda está subindo não é ambiente do tour: não pode ser
      // cobrada como ilhada nem servir de ponte.
      const ilhados = ambientesIlhados([
        cena('a', ['b']),
        cena('b', ['c'], 'reading'),
        cena('c'),
      ]);

      expect(ids(ilhados)).toEqual(['c']);
    });
  });

  describe('becosSemSaida', () => {
    it('acha o ambiente de onde não se volta', () => {
      // Entra na cozinha e fica. A única saída é recarregar, que devolve para o
      // início e apaga o passeio.
      const becos = becosSemSaida([cena('a', ['b']), cena('b')]);

      expect(ids(becos)).toEqual(['b']);
    });

    it('não repete o que já é bloqueio', () => {
      // `b` é inalcançável E sem saída. Aparecer nas duas listas faria a tela
      // dizer duas coisas diferentes sobre o mesmo problema.
      const cenas = [cena('a'), cena('b')];

      expect(ids(ambientesIlhados(cenas))).toEqual(['b']);
      expect(becosSemSaida(cenas)).toEqual([]);
    });

    it('fica quieto quando dá para ir e voltar', () => {
      const becos = becosSemSaida([cena('a', ['b']), cena('b', ['a'])]);

      expect(becos).toEqual([]);
    });
  });
});

/**
 * A mesma regra de grafo, sobre as conexoes ESCOLHIDAS.
 *
 * A leitura padrao ve arestas do payload de publicacao, que so conhece hotspot
 * posicionado. Na tela de ordenacao ainda nao ha nenhum -- e e justamente la
 * que o aviso precisa aparecer, antes de o corretor gastar o trabalho.
 */
describe('grafo sobre conexoes escolhidas', () => {
  function conectada(id: string, connections: string[] = []): WizardScene {
    return {
      id,
      room: id.toUpperCase(),
      fileName: `${id}.jpg`,
      fileSize: 1024,
      imageData: 'data:image/jpeg;base64,x',
      order: 0,
      hotspots: [],
      state: 'ready',
      connections,
    };
  }

  it('sem conexao nenhuma, todos menos o primeiro estao ilhados', () => {
    const cenas = [conectada('a'), conectada('b'), conectada('c')];
    const ilhados = ambientesIlhados(cenas, saidasEscolhidas);

    expect(ilhados.map((s) => s.id)).toEqual(['b', 'c']);
  });

  it('corrente ligada nao tem ilhado', () => {
    const cenas = [
      conectada('a', ['b']),
      conectada('b', ['a', 'c']),
      conectada('c', ['b']),
    ];
    expect(ambientesIlhados(cenas, saidasEscolhidas)).toEqual([]);
  });

  it('um ambiente solto e apontado como ilhado', () => {
    const cenas = [conectada('a', ['b']), conectada('b', ['a']), conectada('c')];
    const ilhados = ambientesIlhados(cenas, saidasEscolhidas);

    expect(ilhados.map((s) => s.id)).toEqual(['c']);
  });

  // Onde o descarte do fantasma importa de verdade e no beco sem saida: um
  // ambiente cuja unica conexao aponta para um id que nao existe mais E um
  // beco, e sem o descarte ele contaria como tendo saida.
  //
  // No `ambientesIlhados` o filtro nao muda resultado nenhum -- o id fantasma
  // entra no conjunto de visitados e nunca mais e consultado. Escrever o teste
  // la seria uma assercao verdadeira pelo motivo errado.
  it('conexao para ambiente que nao existe nao conta como saida', () => {
    const cenas = [
      conectada('a', ['b']),
      conectada('b', ['fantasma']),
    ];
    const becos = becosSemSaida(cenas, saidasEscolhidas);

    expect(becos.map((s) => s.id)).toEqual(['b']);
  });

  // A leitura padrao continua sendo a do publicar: e ela que o canAdvance da
  // etapa de passagens usa, e ela nao pode passar a enxergar conexao sem ponto.
  it('a leitura padrao continua vendo so hotspot posicionado', () => {
    const cenas = [conectada('a', ['b']), conectada('b', ['a'])];
    const ilhados = ambientesIlhados(cenas);

    expect(ilhados.map((s) => s.id)).toEqual(['b']);
  });

  it('becosSemSaida tambem aceita a fonte escolhida', () => {
    const cenas = [conectada('a', ['b']), conectada('b')];
    const becos = becosSemSaida(cenas, saidasEscolhidas);

    expect(becos.map((s) => s.id)).toEqual(['b']);
  });
});


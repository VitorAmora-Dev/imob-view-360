import { ambientesIlhados, becosSemSaida } from './scene-graph';
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

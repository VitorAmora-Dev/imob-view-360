import { TourDraftStore } from './tour-draft.store';
import { WizardScene } from './tour-wizard.model';

/**
 * Testa o CONTRATO do store, não a implementação.
 *
 * Estas regras são o que a Frente B assume ao construir a etapa 2 e o que a
 * Frente A assume ao construir o rodapé e o stepper. Quebrar uma delas quebra
 * a outra frente silenciosamente — daí valerem um teste já no commit-zero,
 * antes de existir uma linha de UI.
 */
describe('TourDraftStore (contrato)', () => {
  function scene(id: string, over: Partial<WizardScene> = {}): WizardScene {
    return {
      id,
      room: id,
      fileName: `${id}.jpg`,
      fileSize: 1024,
      imageData: 'data:image/jpeg;base64,x',
      order: 0,
      hotspots: [],
      state: 'ready',
      ...over,
    };
  }

  function storeWith(...scenes: WizardScene[]): TourDraftStore {
    const store = new TourDraftStore();
    store.scenes.set(scenes.map((s, i) => ({ ...s, order: i })));
    store.selectedSceneId.set(scenes[0]?.id ?? null);
    return store;
  }

  describe('a regra bloqueante da etapa 1', () => {
    it('não avança sem nenhuma imagem', () => {
      const store = new TourDraftStore();
      expect(store.canAdvance()).toBe(false);

      store.next();

      expect(store.step()).toBe(1);
    });

    it('não conta imagem recusada na validação', () => {
      const store = storeWith(
        scene('a', { state: 'rejected', rejectedReason: 'size' }),
      );

      expect(store.canAdvance()).toBe(false);
    });

    it('avança com ao menos uma imagem válida', () => {
      const store = storeWith(scene('a'));

      store.next();

      expect(store.step()).toBe(2);
    });
  });

  describe('alcançabilidade das etapas pelo stepper', () => {
    it('deixa voltar a qualquer etapa já visitada', () => {
      const store = storeWith(scene('a'));
      store.goTo(3);

      expect(store.canReach(1)).toBe(true);
      expect(store.canReach(2)).toBe(true);
    });

    it('bloqueia 2 e 3 enquanto não há imagem', () => {
      const store = new TourDraftStore();

      expect(store.canReach(2)).toBe(false);
      expect(store.canReach(3)).toBe(false);

      store.goTo(3);

      expect(store.step()).toBe(1);
    });
  });

  describe('remoção de ambiente', () => {
    it('zera o destino dos hotspots que apontavam para ele', () => {
      const store = storeWith(
        scene('a', {
          hotspots: [{ id: 'h1', u: 0.5, v: 0.5, label: 'Porta', target: 'b' }],
        }),
        scene('b'),
      );

      store.removeScene('b');

      expect(store.scenes()[0].hotspots[0].target).toBeNull();
    });

    it('reordena as cenas restantes, para a capa continuar sendo a primeira', () => {
      const store = storeWith(scene('a'), scene('b'), scene('c'));

      store.removeScene('a');

      expect(store.scenes().map((s) => s.order)).toEqual([0, 1]);
      expect(store.coverScene()?.id).toBe('b');
    });

    it('seleciona a primeira restante quando remove a que estava aberta', () => {
      const store = storeWith(scene('a'), scene('b'));
      store.selectScene('a');

      store.removeScene('a');

      expect(store.selectedSceneId()).toBe('b');
    });
  });

  describe('patchScene — a porta da Frente B', () => {
    it('altera só a cena alvo', () => {
      const store = storeWith(scene('a'), scene('b'));

      store.patchScene('a', (s) => ({
        ...s,
        hotspots: [{ id: 'h1', u: 0.1, v: 0.2, label: '', target: null }],
      }));

      expect(store.scenes()[0].hotspots.length).toBe(1);
      expect(store.scenes()[1].hotspots.length).toBe(0);
    });
  });

  describe('derivados que o resumo e o rodapé leem', () => {
    it('soma os hotspots de TODOS os ambientes, não só o selecionado', () => {
      const store = storeWith(
        scene('a', {
          hotspots: [{ id: 'h1', u: 0, v: 0, label: '', target: null }],
        }),
        scene('b', {
          hotspots: [
            { id: 'h2', u: 0, v: 0, label: '', target: null },
            { id: 'h3', u: 0, v: 0, label: '', target: null },
          ],
        }),
      );

      expect(store.totalHotspots()).toBe(3);
    });

    it('vai a 100% no estado publicado, seja qual for a etapa', () => {
      const store = storeWith(scene('a'));
      store.published.set(true);

      expect(store.progressPct()).toBe(100);
    });
  });

  describe('voltar', () => {
    it('não desce abaixo da etapa 1', () => {
      const store = new TourDraftStore();

      store.back();

      expect(store.step()).toBe(1);
    });
  });
});

import { Component, computed, effect, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardScene } from '../../tour-wizard.model';

/**
 * Rail de ambientes sob o viewer (tarefa B5).
 *
 * DONO: Frente B.
 *
 * Trocar de ambiente aqui é a única forma de marcar pontos em mais de uma foto,
 * então o rail é o que transforma a etapa 2 de "uma tela" em "o tour inteiro".
 *
 * Só ambientes VÁLIDOS entram: uma cena recusada não tem imagem para o viewer
 * abrir, e oferecê-la seria oferecer um beco sem saída.
 */
@Component({
  selector: 'app-scene-rail',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './scene-rail.component.html',
  styleUrls: ['./scene-rail.component.scss'],
})
export class SceneRailComponent {
  private readonly draft = inject(TourDraftStore);
  private readonly editor = inject(HotspotEditorStore);

  readonly scenes = computed(() => this.draft.readyScenes());
  readonly selectedId = computed(() => this.draft.selectedSceneId());

  constructor() {
    /**
     * Pede a miniatura dos cômodos que ainda não têm foto em memória.
     *
     * Numa captura retomada isso é a lista inteira: o rascunho é lido sem
     * coluna de imagem, e quem baixa a foto grande é o viewer — só a do cômodo
     * SELECIONADO. Ninguém pedia pelos outros, e o rail abria com todas as
     * miniaturas em branco. Aqui vai a versão pequena; a esfera continua sendo
     * assunto do viewer.
     */
    effect(() => {
      for (const cena of this.scenes()) {
        if (this.fundoDe(cena)) continue;
        void this.draft.garantirMiniatura(cena.id);
      }
    });
  }

  /**
   * `background-image` da miniatura, ou `null` quando não há imagem nenhuma.
   *
   * `null` e não `url('')`: com a string vazia o navegador desenha o ícone de
   * imagem quebrada, que é exatamente o que o rail mostrava em toda cena
   * retomada — ele lia `scene.imageData` direto, e numa cena retomada esse
   * campo é vazio de propósito.
   */
  fundoDe(scene: WizardScene): string | null {
    const url =
      scene.treatedImageUrl ?? (scene.imageData || this.draft.miniatura(scene.id));
    return url ? `url(${url})` : null;
  }

  /**
   * Quantos pontos cada ambiente já tem, para o rail dizer onde falta trabalho
   * sem obrigar a visitar um por um.
   */
  countOf(sceneId: string): number {
    return this.scenes().find((s) => s.id === sceneId)?.hotspots.length ?? 0;
  }

  /**
   * Trocar de ambiente fecha o sheet: ele mostra os pontos do ambiente que
   * estava aberto, e mantê-lo de pé sobre outra foto mostraria uma lista que
   * não corresponde ao que está na tela.
   */
  select(sceneId: string): void {
    if (sceneId === this.selectedId()) return;
    this.editor.closeSheet();
    this.draft.selectScene(sceneId);
  }
}

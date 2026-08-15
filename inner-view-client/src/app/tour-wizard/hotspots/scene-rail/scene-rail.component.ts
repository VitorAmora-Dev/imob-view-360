import { Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { TourDraftStore } from '../../tour-draft.store';

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

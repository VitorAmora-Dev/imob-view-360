import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { Panorama } from '../../models/virtual-tour.model';
import { PanoramaImageCache } from '../../services/panorama-image-cache.service';
import { TourSheetComponent } from '../tour-sheet/tour-sheet.component';

/**
 * Largura pedida ao servidor para a miniatura de cada card.
 *
 * Num telefone de 390px cada card fica com ~165px; 320 cobre DPR 2 sem
 * desperdício. Sem esse parâmetro a rota devolve a equirretangular inteira —
 * dezenas de MB por cômodo —, e é isso que tornaria trinta cenas inviáveis.
 */
const LARGURA_DA_MINIATURA = 320;

/**
 * O sheet "Cenas do tour": primeiro consumidor do `TourSheetComponent`.
 *
 * Fechar ao escolher é regra DESTE sheet e mora aqui, não no shell: TV-4 diz
 * com todas as letras que copiar código mantém o sheet aberto. Se a regra
 * subisse para o shell, o primeiro consumidor teria ditado a API para os
 * outros três.
 */
@Component({
  selector: 'app-cenas-sheet',
  standalone: true,
  imports: [TourSheetComponent, TranslatePipe],
  templateUrl: './cenas-sheet.component.html',
  styleUrls: ['./cenas-sheet.component.scss'],
})
export class CenasSheetComponent {
  readonly cenas = input<Panorama[]>([]);
  readonly atualId = input<string | null>(null);

  /**
   * Se este sheet está aberto.
   *
   * Entra por `input`, e não por um store injetado, pelo MESMO motivo que o
   * `TourSheetComponent` recebe `isOpen` pronto em vez de consultar quem quer
   * que seja: quem sabe qual sheet está aberto é a tela, e um sheet que
   * pergunta isso sozinho amarra-se à tela que o hospeda.
   *
   * Quem responde, no visualizador, é `TourViewerStore.sheet` — o mesmo sinal
   * que decide a faixa de cenas e que TV-4, TV-5 e TV-6 vão consultar. Um
   * segundo coordenador só para sheets daria dois lugares para saber a mesma
   * coisa, e nada garantiria que concordassem.
   */
  readonly aberto = input(false);

  readonly selecionada = output<Panorama>();
  readonly fechado = output<void>();

  private readonly imagens = inject(PanoramaImageCache);

  /**
   * Mesma ordem do tour — `order` crescente, igual ao que o
   * `panoramic-viewer` usa em `atualizarNav()`. Duas listas das mesmas cenas
   * em ordens diferentes seria percebido como aleatoriedade.
   */
  readonly ordenadas = computed(() =>
    [...this.cenas()].sort((a, b) => a.order - b.order),
  );

  /** `panoramaId` → `blob:` da miniatura, conforme o cache vai respondendo. */
  private readonly blobs = signal<Record<string, string>>({});

  /**
   * Baixa as miniaturas quando o sheet ABRE, e não na construção.
   *
   * O gatilho é a abertura porque o `<app-cenas-sheet>` mora no template da
   * página do visualizador e é construído junto com ela: disparar no construtor
   * cobraria trinta downloads de todo mundo que abre um tour, inclusive de
   * quem nunca toca no botão de cenas.
   *
   * Todas de uma vez, e não sob demanda: é o que a `lista-de-rascunhos` já faz
   * (um download por rascunho, em paralelo). O `loading="lazy"` que o `<img>`
   * tinha deixou de ser uma opção junto com o `src` da API — um `blob:` só
   * existe DEPOIS de baixado, então `lazy` sobre ele não adiaria download
   * nenhum. Quem segura a conta é o `LARGURA_DA_MINIATURA`. Um
   * `IntersectionObserver` para adiar as linhas de baixo seria mecanismo novo
   * sem precedente no repositório, e fica para quem medir que ele é preciso.
   *
   * `untracked` no corpo: `carregarMiniatura` LÊ `blobs()` para não repetir
   * download, e uma leitura rastreada aqui faria cada `blob:` que chega
   * reagendar o effect inteiro.
   */
  constructor() {
    effect(() => {
      if (!this.aberto()) return;
      const cenas = this.ordenadas();
      untracked(() => {
        for (const cena of cenas) void this.carregarMiniatura(cena);
      });
    });
  }

  /**
   * A miniatura passa pelo cache, e NUNCA por `<img src="/api/...">` direto.
   *
   * A rota `/panoramas/:id/preview` é autenticada (`JwtAccessGuard`), o token
   * mora no `localStorage` e a tag `<img>` não passa pelo `authInterceptor` —
   * ela não tem como levar o token. Apontar o `src` para a API dava trinta
   * 401 e trinta cards vazios distinguíveis só pelo nome. O caminho é sempre
   * `HttpClient` → `blob:` → tela; é a mesma regra que
   * `panorama-image-cache.service.ts` e `lista-de-rascunhos` já registram, e
   * ignorá-la foi o que deixou a tela do tour branca em `036b4ac`.
   *
   * Não há `liberar()` no destroy: o cache é `providedIn: 'root'` e os mesmos
   * `blob:` são compartilhados com o wizard e com o viewer. Revogar aqui
   * apagaria a imagem debaixo de quem ainda a está mostrando.
   */
  private async carregarMiniatura(cena: Panorama): Promise<void> {
    if (this.blobs()[cena.id]) return;

    const url = await this.imagens
      .obter(cena.id, 'treated', LARGURA_DA_MINIATURA)
      .catch(() => '');
    if (!url) return;

    this.blobs.update((atual) => ({ ...atual, [cena.id]: url }));
  }

  /** `undefined` enquanto o download não terminou — ver o template. */
  miniatura(cena: Panorama): string | undefined {
    return this.blobs()[cena.id];
  }

  escolher(cena: Panorama): void {
    this.selecionada.emit(cena);
    this.fechado.emit();
  }
}

import { Component, Input, OnDestroy, OnChanges, SimpleChanges, ElementRef, ViewChild, AfterViewInit, Output, EventEmitter } from '@angular/core';
import { IonSpinner } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Panorama } from '../../models/virtual-tour.model';
import { urlDaImagem } from '../../models/panorama-image.util';

/**
 * Deslocamento, em px, acima do qual o gesto conta como arrasto e não clique.
 * Cobre o tremor de mão sem engolir um toque curto de verdade.
 */
const DRAG_SLOP_PX = 6;

@Component({
  selector: 'app-panoramic-viewer',
  standalone: true,
  imports: [IonSpinner, TranslatePipe],
  template: `
    <!--
      A planta na parede.

      O visitante só trocava de ambiente clicando num hotspot: sem lista, sem
      menu, sem voltar. Um ambiente que ninguém ligou não ficava difícil de
      achar — ficava INEXISTENTE, fotografado e pago, e a única defesa era o
      wizard proibir de publicar assim.

      Mora aqui dentro, e não nas páginas que usam o viewer, de propósito: se
      fosse peça avulsa, a próxima tela que mostrasse um tour esqueceria de
      incluí-la e o buraco voltaria calado. Sendo do viewer, não existe tour sem
      ela.

      Some sozinha com um ambiente só — não há para onde ir. Fora isso, quem não
      a quiser precisa DIZER que não quer: o padrão é aparecer, para que
      esquecer de pensar no assunto seja o caso seguro.

      Nada aqui pode ser getter que aloque nem chamada de método: o laço de
      render deste componente roda DENTRO da zona, então cada expressão do
      template é reavaliada umas 60 vezes por segundo. Tudo o que o template lê
      é campo simples, recalculado no ngOnChanges e ao trocar de panorama.
    -->
    @if (mostrarNav) {
      <nav class="viewer-nav" [attr.aria-label]="'VIEWER.ROOMS' | translate">
        <button
          type="button"
          class="viewer-nav__atual"
          [attr.aria-expanded]="navAberta"
          (click)="alternarNav()"
          (keydown.escape)="navAberta = false">
          <span class="viewer-nav__dot" aria-hidden="true"></span>
          <span class="viewer-nav__nome">{{ nomeAtual }}</span>
          <span class="viewer-nav__seta" aria-hidden="true">{{ navAberta ? '▴' : '▾' }}</span>
        </button>

        @if (navAberta) {
          <ul class="viewer-nav__lista" (keydown.escape)="navAberta = false">
            @for (sala of ambientes; track sala.id) {
              <li>
                <button
                  type="button"
                  class="viewer-nav__item"
                  [class.is-atual]="sala.id === idAtual"
                  [attr.aria-current]="sala.id === idAtual ? 'true' : null"
                  (click)="irPara(sala.id)">
                  {{ sala.roomName }}
                </button>
              </li>
            }
          </ul>
        }
      </nav>
    }

    <div #canvasContainer class="canvas-container">
      @if (loading) {
        <div class="loading-overlay">
          <ion-spinner name="crescent"></ion-spinner>
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      position: relative;
    }

    .canvas-container {
      width: 100%;
      height: 100%;
    }

    .loading-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--tour-bg, #0b1220);
    }

    ion-spinner {
      width: 48px;
      height: 48px;
      color: var(--tour-text, #e2e8f0);
    }

    /* ---- A planta na parede -------------------------------------------- */

    .viewer-nav {
      position: absolute;
      /* A página hospedeira ajusta o topo: no inner-view há um cabeçalho
         sobreposto ocupando esta faixa; no embed não há nada. Uma variável só,
         com valor que já serve ao caso simples. */
      top: var(--viewer-nav-top, 16px);
      left: 16px;
      z-index: 5;
      max-width: min(260px, calc(100% - 32px));
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .viewer-nav__atual,
    .viewer-nav__item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      /* Piso de alvo da WCAG. Isto é tocado com o polegar, sobre uma foto. */
      min-height: 44px;
      padding: 0 14px;
      border: 2px solid var(--tw-pin-accent, #2dd4bf);
      border-radius: 999px;
      /* Mesma pílula do pin: é a mesma linguagem de "toque aqui para ir". */
      background: var(--tw-pin-bg-canvas, rgba(11, 18, 32, 0.95));
      backdrop-filter: blur(7px);
      box-shadow: var(--tw-shadow-pin, 0 3px 12px rgba(0, 0, 0, 0.3));
      color: #fff;
      font: inherit;
      font-size: 14px;
      font-weight: 600;
      line-height: 1;
      cursor: pointer;
      text-align: left;
    }

    .viewer-nav__dot {
      flex: 0 0 auto;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--tw-pin-accent, #2dd4bf);
    }

    .viewer-nav__nome {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .viewer-nav__seta {
      flex: 0 0 auto;
      opacity: 0.75;
      font-size: 12px;
    }

    .viewer-nav__lista {
      /* Teto com rolagem: num celular a foto tem pouca altura, e um tour de dez
         ambientes faria a lista passar da tela inteira. */
      max-height: min(46vh, 320px);
      overflow-y: auto;
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .viewer-nav__item {
      border-color: rgba(255, 255, 255, 0.22);
      border-radius: 12px;
      font-weight: 500;
    }

    .viewer-nav__item:hover {
      border-color: rgba(255, 255, 255, 0.45);
    }

    /* O ambiente em que se está: marcado pelo accent E pelo peso do texto,
       nunca só por cor — e o atributo aria-current conta a mesma coisa a quem
       não enxerga nenhuma das duas. */
    .viewer-nav__item.is-atual {
      border-color: var(--tw-pin-accent, #2dd4bf);
      font-weight: 700;
    }

    .viewer-nav__atual:focus-visible,
    .viewer-nav__item:focus-visible {
      outline: 2px solid #fff;
      outline-offset: 2px;
      box-shadow: 0 0 0 5px rgba(0, 0, 0, 0.55);
    }
  `]
})
export class PanoramicViewerComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('canvasContainer', { static: true }) canvasContainer!: ElementRef<HTMLDivElement>;

  @Input() panoramas: Panorama[] = [];
  @Input() editMode = false;

  /**
   * Se a lista de ambientes aparece. Padrão ligado, e isso é a parte que
   * importa: quem monta uma tela nova ganha a navegação sem pedir, e só perde
   * se disser explicitamente que tem outra.
   *
   * Amarrei isto ao `editMode` primeiro, e estava errado: no wizard a etapa 2
   * tem o próprio trilho de ambientes e a lista sobraria, mas o inner-view usa
   * o MESMO `editMode` para marcar hotspots — e ali desligar a lista tirava a
   * única navegação que o dono tinha, sem nada no lugar.
   */
  @Input() roomNav = true;

  /**
   * Como os pontos de navegação são desenhados.
   *
   * `'sprites'` é o padrão, e é o que embed, wizard e captura continuam
   * recebendo sem pedir. A tela de visualização refeita passa `'none'` e
   * desenha os seus por cima, em HTML (decisão D3 do SPRINT-4-TOUR-VIEWER.md):
   * disco deitado com perspectiva, halo em gradiente e anel que pulsa são
   * coisas de CSS, e o `<button>` ainda traz teclado e leitor de tela.
   *
   * Aditivo de propósito: quem não disser nada não vê diferença.
   *
   * `hotspotMode` e não `hotspots`: há outros dois inputs com esse nome no app
   * — nos dois overlays — e ambos recebem a LISTA de pontos. Na página do
   * visualizador os dois apareciam a setenta linhas de distância, e
   * `[hotspots]="'none'"` lia como "não há hotspots" quando quer dizer "não
   * desenhe você".
   */
  @Input() hotspotMode: 'sprites' | 'none' = 'sprites';

  /**
   * Imagem que deve SUBSTITUIR a que está à vista, com uma dissolvência.
   *
   * É como a etapa 2 do wizard revela o resultado da montagem por IA: o cômodo
   * já está na tela, costurado, e a versão tratada chega segundos depois. Trocar
   * a textura direto — que é o que uma mudança de `panoramas` faz — daria um
   * salto seco com spinner no meio, e o corretor não veria o que mudou.
   *
   * Um `blob:` ou `data:`, não o endereço da API: a rota de preview é
   * autenticada e o `TextureLoader` carrega sem interceptor.
   *
   * `null` desfaz nada — o que já foi revelado continua onde está.
   */
  @Input() revealUrl: string | null = null;

  @Output() panoramaChange = new EventEmitter<Panorama>();
  @Output() hotspotPlaced = new EventEmitter<{ positionX: number; positionY: number }>();

  /**
   * Um toque na foto que não acertou nada.
   *
   * Existe para o modo imersivo da tela de visualização: tocar no panorama
   * esconde e mostra o chrome. Só dispara em toque de verdade — o arrasto que
   * gira a esfera já é descartado por `suppressNextClick` — e nunca quando o
   * toque caiu num hotspot.
   */
  @Output() canvasTapped = new EventEmitter<void>();

  /**
   * A foto deste cômodo não carregou.
   *
   * O `TextureLoader` engolia a falha e só desligava o spinner: a tela ficava
   * com a foto do cômodo ANTERIOR e nenhum aviso, o que é pior que a tela
   * preta — quem olha não sabe que está vendo outro lugar. Quem ouve decide o
   * que mostrar; aqui só se sabe que falhou.
   */
  @Output() loadFailed = new EventEmitter<Panorama>();

  loading = true;

  // ---- planta na parede ---------------------------------------------------
  //
  // TUDO aqui é campo simples, e não getter nem método. O template deste
  // componente é reavaliado a cada frame do laço de render (~60/s, dentro da
  // zona), então um getter que ordenasse a lista devolveria um array novo
  // sessenta vezes por segundo — e o `@for` refaria o diff em cima disso.

  /** Ambientes na ordem do tour, para a lista. */
  ambientes: Panorama[] = [];
  mostrarNav = false;
  navAberta = false;
  idAtual: string | null = null;

  /**
   * Identifica a carga de textura em voo.
   *
   * `TextureLoader.load` é assíncrono e não cancelável, e os callbacks chegam
   * em ordem de CONCLUSÃO, não de pedido. Sem esta identidade, dois toques
   * rápidos deixavam duas cargas correndo e vencia a que baixasse por último:
   * medido com a rede estrangulada, três toques rendiam quatro trocas de foto
   * — `q → b → quar → b` —, com o cômodo errado aparecendo no meio e uma
   * equirretangular inteira baixada de novo para desfazer.
   *
   * `idAtual` não servia para isso: ele só é escrito no sucesso, então durante
   * a carga ele ainda aponta para o cômodo ANTERIOR e as duas cargas o veem
   * igual.
   */
  private pedidoDeTextura = 0;
  nomeAtual = '';

  alternarNav(): void {
    this.navAberta = !this.navAberta;
  }

  irPara(id: string): void {
    this.navAberta = false;
    if (id === this.idAtual) return;
    this.navigateTo(id);
  }

  /** Recalcula o que a nav mostra. Chamado quando as entradas ou a cena mudam. */
  private atualizarNav(): void {
    this.ambientes = [...this.panoramas].sort((a, b) => a.order - b.order);
    this.mostrarNav = this.roomNav && this.ambientes.length > 1;
    if (!this.mostrarNav) this.navAberta = false;
  }

  /**
   * Câmera do three.js, para o overlay HTML de pins da etapa 2 projetar cada
   * hotspot em coordenadas de tela. `null` até o init, que é adiado um tick.
   */
  get viewerCamera(): THREE.PerspectiveCamera | null {
    return this.initialized ? this.camera : null;
  }

  /** Tamanho do canvas em px CSS — o denominador da projeção para a tela. */
  get viewerSize(): { width: number; height: number } | null {
    if (!this.initialized) return null;
    const canvas = this.renderer.domElement;
    return { width: canvas.clientWidth, height: canvas.clientHeight };
  }

  /**
   * Devolve a câmera ao ângulo inicial.
   *
   * Público e aditivo: quem não chamar não vê diferença nenhuma. Existe para o
   * assistente guiado, que troca de ambiente a cada passo — e `loadPanorama()`
   * troca só a textura, deixando o OrbitControls no ângulo do ambiente
   * anterior. Num tour montado com fotos de celular esse ângulo não quer dizer
   * nada na foto nova: equirretangulares não compartilham orientação de bússola.
   *
   * O `(0, 0, 0.1)` é o mesmo valor de `initThreeJS`, e não um número novo: a
   * câmera vive no centro da esfera, e o 0.1 é o empurrão que dá ao
   * OrbitControls uma direção de partida em vez de um vetor nulo.
   *
   * Silencioso antes de inicializar e depois do destroy, porque quem chama é um
   * `effect` e ele pode disparar em qualquer ordem em relação ao ciclo de vida.
   */
  resetView(): void {
    if (!this.initialized) return;

    this.camera.position.set(0, 0, 0.1);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  /**
   * Assina um callback rodado ao fim de cada frame, já com a câmera atualizada
   * pelo OrbitControls. Devolve a função que cancela.
   *
   * Deliberadamente NÃO é um `@Output`: um EventEmitter aqui dispararia change
   * detection do Angular 60 vezes por segundo. Quem assina escreve direto no
   * DOM. E é chamado de dentro deste laço, e não de um requestAnimationFrame
   * próprio, para que os pins e a foto andem no mesmo frame — em laços
   * separados eles saem de sincronia e os pins arrastam atrás no giro rápido.
   */
  onFrame(callback: () => void): () => void {
    this.frameCallbacks.add(callback);
    return () => {
      this.frameCallbacks.delete(callback);
    };
  }

  /**
   * O par `(u, v)` do panorama sob um ponto da tela, em coordenadas de cliente.
   * `null` antes do init ou quando o raio não acerta a esfera.
   *
   * O `v` sai já na convenção do backend (`positionY`, com 0 no TOPO), que é a
   * mesma de `hotspotPlaced` e do `WizardHotspot` — ver a cadeia inteira em
   * `hotspot-projection.ts`.
   *
   * É público porque o arraste de pin (B9) precisa da MESMA conta que o clique:
   * um ponto arrastado tem de parar exatamente onde um clique no mesmo pixel o
   * colocaria. Duas implementações da conversão divergiriam, e o sintoma seria
   * o pin escapando do dedo — sem erro nenhum no console.
   */
  uvAt(clientX: number, clientY: number): { u: number; v: number } | null {
    if (!this.initialized) return null;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObject(this.sphereMesh);
    const uv = hits[0]?.uv;

    // Three.js SphereGeometry has -x in its formula; scale(-1,1,1) cancels it
    // back to +x, so positionX = u directly. The vertical axis flips once:
    // the geometry writes uv.y = 1 at the top pole, and the backend wants 0
    // there.
    return uv ? { u: uv.x, v: 1 - uv.y } : null;
  }

  private readonly frameCallbacks = new Set<() => void>();
  private pointerDownAt: { x: number; y: number } | null = null;
  private suppressNextClick = false;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;
  private sphereMesh!: THREE.Mesh;
  private hotspotSprites: THREE.Sprite[] = [];
  private hotspotTargetMap = new Map<THREE.Sprite, string>();
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private animationFrameId: number | null = null;
  private initTimeout: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;

  // ---- dissolvência da revelação ------------------------------------------
  //
  // Uma segunda esfera, de raio menor, com material transparente. Vista do
  // centro ela fica NA FRENTE da primeira, então subir a opacidade de 0 a 1
  // dissolve a imagem nova por cima da antiga.
  //
  // Escolhida em vez de um `ShaderMaterial` com dois samplers: o shader faria
  // varredura direcional além da dissolvência, mas trocaria o
  // `MeshBasicMaterial` que o resto deste arquivo assume em três lugares. Uma
  // esfera a mais custa 120×80 triângulos e nenhuma suposição.
  private revealMesh!: THREE.Mesh;
  private revelacaoInicio: number | null = null;
  /** Qual URL já foi revelada, para não repetir a dissolvência a cada render. */
  private urlRevelada: string | null = null;

  /** Duração da dissolvência. Longo o bastante para o olho seguir a mudança. */
  private static readonly DURACAO_REVELACAO_MS = 900;

  ngAfterViewInit() {
    this.initTimeout = setTimeout(() => {
      this.initTimeout = null;
      this.initThreeJS();
      this.initialized = true;
      if (this.panoramas.length > 0) {
        this.loadInitialPanorama();
      }
    }, 0);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['panoramas'] && !changes['panoramas'].firstChange && this.initialized) {
      if (this.panoramas.length > 0) {
        this.loadInitialPanorama();
      }
    }
    if (changes['revealUrl'] && this.initialized) {
      this.revelar();
    }
    if (changes['editMode'] && this.initialized) {
      this.renderer.domElement.style.cursor = this.editMode ? 'crosshair' : 'grab';
    }
    // Fora do `initialized`: a lista de ambientes é HTML e não depende de o
    // three.js já ter subido. Presa ao init, ela não apareceria no primeiro
    // desenho — o init é adiado um tick de propósito.
    if (changes['panoramas'] || changes['roomNav']) this.atualizarNav();
    // Trocar o modo com a tela montada: sem isto os sprites só sumiriam na
    // próxima troca de cômodo.
    // Sem `!firstChange` aqui, ao contrário de `panoramas`: uma tela pode
    // decidir o modo depois de montada, e essa PRIMEIRA mudança é justamente a
    // que precisa limpar. O `initialized` já barra a chamada de criação, quando
    // ainda não há sprite nenhum para limpar.
    if (changes['hotspotMode'] && this.initialized) {
      this.clearHotspots();
      const atual = this.panoramas.find((p) => p.id === this.idAtual);
      if (atual) this.addHotspots(atual);
    }
  }

  ngOnDestroy() {
    // O init é adiado um tick, e o componente pode morrer antes de ele rodar —
    // a etapa 2 monta o viewer dentro de um `@if` que some quando a última cena
    // válida sai. Sem cancelar, o timeout ainda dispararia `initThreeJS()`
    // sobre um container já desanexado, criando um contexto WebGL órfão, um
    // laço de rAF que ninguém para e um listener de resize que ninguém tira —
    // exatamente os vazamentos que o `forceContextLoss()` abaixo existe para
    // evitar.
    if (this.initTimeout !== null) {
      clearTimeout(this.initTimeout);
      this.initTimeout = null;
    }
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.renderer?.domElement.removeEventListener('click', this.onCanvasClick);
    this.renderer?.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer?.domElement.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('resize', this.onWindowResize);
    this.frameCallbacks.clear();
    this.clearHotspots();
    // A esfera também é nossa: geometria, material e a textura carregada.
    const material = this.sphereMesh?.material as THREE.MeshBasicMaterial | undefined;
    material?.map?.dispose();
    material?.dispose();
    this.sphereMesh?.geometry.dispose();
    // A esfera da revelação tem os mesmos três recursos, e o browser só mantém
    // ~16 contextos WebGL vivos — deixá-la de fora dobraria o vazamento que o
    // bloco acima existe para não ter.
    const materialReveal = this.revealMesh?.material as THREE.MeshBasicMaterial | undefined;
    materialReveal?.map?.dispose();
    materialReveal?.dispose();
    this.revealMesh?.geometry.dispose();
    this.controls?.dispose();
    // `dispose()` solta os recursos mas não o contexto WebGL em si, e o browser
    // só mantém ~16 vivos. A etapa 2 monta e desmonta este componente a cada
    // ida e volta entre etapas do wizard, então sem isto o canvas morre com
    // "too many active WebGL contexts" depois de algumas navegações.
    this.renderer?.forceContextLoss();
    this.renderer?.dispose();
  }

  navigateTo(targetId: string) {
    const target = this.panoramas.find(p => p.id === targetId);
    if (target) {
      this.loadPanorama(target);
    }
  }

  reloadHotspots(panorama: Panorama) {
    this.clearHotspots();
    this.addHotspots(panorama);
  }

  private loadInitialPanorama() {
    const initial = this.panoramas.find(p => p.initialPanorama)
      ?? this.panoramas.reduce((a, b) => a.order <= b.order ? a : b);
    this.loadPanorama(initial);
  }

  private loadPanorama(panorama: Panorama) {
    const pedido = ++this.pedidoDeTextura;
    this.loading = true;
    // Trocar de cômodo invalida qualquer revelação em curso: ela dissolveria a
    // imagem tratada de uma sala por cima da foto de outra.
    this.cancelarRevelacao();
    // A foto vem por URL, não mais embutida no JSON do tour. Para o
    // `TextureLoader` dá no mesmo — ele aceita endereço e data-URI pela mesma
    // porta —, mas para quem abre o tour muda tudo: o primeiro cômodo aparece
    // sem esperar os outros, e trocar de sala pela segunda vez vem do cache do
    // navegador em vez de outro download.
    const endereco = urlDaImagem(panorama);

    const loader = new THREE.TextureLoader();
    loader.load(
      endereco,
      (texture) => {
        // Chegou tarde: outro cômodo foi pedido enquanto esta baixava. Não
        // basta ignorar — a textura já existe na GPU e ninguém mais a
        // referencia, e uma equirretangular de 8192×4096 são ~128 MB.
        if (pedido !== this.pedidoDeTextura) {
          texture.dispose();
          return;
        }

        texture.colorSpace = THREE.SRGBColorSpace;
        // An equirect wraps the sphere very unevenly: near the poles a row of
        // texels is squeezed into almost no screen width, so isotropic mip
        // selection picks a coarse level and the ceiling and floor go soft.
        // This is a texture-filtering blur, not a stitching one.
        texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

        const material = this.sphereMesh.material as THREE.MeshBasicMaterial;
        // A textura anterior tem de ser solta ANTES de perder a referência.
        // `map = novaTextura` só troca o ponteiro: a antiga continua ocupando
        // memória de GPU até o contexto morrer, e uma equirretangular de
        // 8192×4096 são ~128 MB descomprimidos. Trocar de ambiente algumas
        // vezes bastava para chegar em CONTEXT_LOST_WEBGL e a tela ficar preta.
        material.map?.dispose();
        material.map = texture;
        material.needsUpdate = true;
        this.clearHotspots();
        this.addHotspots(panorama);
        this.loading = false;
        // A nav diz onde a pessoa ESTÁ, então ela troca de nome quando a foto
        // troca — venha a troca da própria lista ou de um clique num hotspot.
        this.idAtual = panorama.id;
        this.nomeAtual = panorama.roomName;
        this.panoramaChange.emit(panorama);
      },
      undefined,
      () => {
        // A falha de um pedido abandonado não é notícia: quem está na tela é
        // outro cômodo, que carregou bem. Sem esta guarda o `loadFailed`
        // atrasado apagava o `loading` de uma carga ainda em curso.
        if (pedido !== this.pedidoDeTextura) return;

        this.loading = false;
        this.loadFailed.emit(panorama);
      }
    );
  }

  /**
   * Quantos pixels de verdade por pixel de CSS.
   *
   * Sem isto o `WebGLRenderer` fica em 1, que é o padrão do three.js, e num
   * celular de DPR 3 o viewer desenha **11% dos pixels que a tela tem** —
   * medido: buffer de 358×269 numa tela de 1074×807. O compositor estica o
   * resto. Não é a foto que está ruim nem a costura: é o viewer renderizando em
   * um terço da resolução linear e sendo ampliado.
   *
   * O teto de 2 não é timidez. DPR 3 custaria 9× os pixels de DPR 1, e este
   * viewer não desenha um cubo: é uma esfera de 120×80 segmentos com uma
   * equirretangular que pode ter 8192px de largura, num GPU de celular. A 2×
   * já são 4× os pixels, e é o degrau em que a diferença ainda se vê a olho —
   * de 2 para 3 quase não se vê, e o custo é o mesmo tanto de novo.
   */
  private pixelRatioAlvo(): number {
    return Math.min(window.devicePixelRatio || 1, 2);
  }

  private initThreeJS() {
    const container = this.canvasContainer.nativeElement;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 1, 1100);
    this.camera.position.set(0, 0, 0.1);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(this.pixelRatioAlvo());
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableZoom = true;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = -0.5;

    // UVs are interpolated linearly across each face, so coarse segments bend
    // straight lines — 60×40 spans 6° per segment, enough to visibly curve a
    // wall corner. Denser costs nothing at this triangle count.
    const geometry = new THREE.SphereGeometry(500, 120, 80);
    geometry.scale(-1, 1, 1);
    this.sphereMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    this.scene.add(this.sphereMesh);

    // Raio 499 contra 500: de dentro, a menor está mais perto da câmera e
    // desenha por cima. `depthWrite: false` para ela não gravar profundidade
    // enquanto está meio transparente, o que deixaria buracos na de trás.
    const geometriaReveal = new THREE.SphereGeometry(499, 120, 80);
    geometriaReveal.scale(-1, 1, 1);
    this.revealMesh = new THREE.Mesh(
      geometriaReveal,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    this.revealMesh.visible = false;
    this.revealMesh.renderOrder = 1;
    this.scene.add(this.revealMesh);

    this.renderer.domElement.addEventListener('click', this.onCanvasClick);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('resize', this.onWindowResize);

    this.animate();
  }

  private addHotspots(panorama: Panorama) {
    // Quem desenha os pontos é outra camada. Sair aqui, e não deixar de chamar
    // lá de cima, mantém o `clearHotspots(); addHotspots()` de `loadPanorama`
    // como um par simétrico — e evita que a próxima troca de cômodo traga os
    // sprites de volta por um caminho que ninguém lembrou de cobrir.
    if (this.hotspotMode === 'none') return;

    for (const hotspot of panorama.originHotspots) {
      // De (positionX, positionY) para a posição 3D dentro da esfera invertida.
      //
      // `theta` é medido a partir de +Y, e `positionY = 0` é o TOPO — daí a
      // multiplicação direta. A cadeia, que é fácil de derivar ao contrário:
      // `SphereGeometry` grava `uv.y = 1 - v_geom` com `v_geom = 0` no polo de
      // cima, e `onCanvasClick` emite `positionY = 1 - uv.y`. Os dois "1 -" se
      // cancelam: `positionY = v_geom`, e o theta da geometria é `v_geom * π`.
      //
      // Estava `(1 - positionY) * π` — que espelhava no equador exatamente o
      // ponto que o clique deste mesmo componente havia gravado. Passava
      // despercebido porque o erro é ZERO no equador, que é onde caem tanto o
      // seed quanto o clique de teste típico, no centro do canvas.
      const phi = hotspot.positionX * 2 * Math.PI;
      const theta = hotspot.positionY * Math.PI;
      const r = 490;
      const x = r * Math.cos(phi) * Math.sin(theta);
      const y = r * Math.cos(theta);
      const z = r * Math.sin(phi) * Math.sin(theta);

      const sprite = this.createHotspotSprite(this.rotuloDo(hotspot));
      sprite.position.set(x, y, z);
      this.scene.add(sprite);
      this.hotspotSprites.push(sprite);
      this.hotspotTargetMap.set(sprite, hotspot.targetId);
    }
  }

  /**
   * O que o pin escreve: o rótulo do ponto ou, na falta dele, o nome do
   * ambiente para onde leva.
   *
   * Era `hotspot.label ?? ''`, e um ponto sem rótulo — que é o estado em que
   * ele NASCE — desenhava uma pílula larga com um dot e nenhum texto. Um botão
   * sem nome flutuando sobre a foto do imóvel, no tour que o cliente recebe.
   *
   * Deriva, não copia: o rótulo vazio quer dizer "use o nome do destino", então
   * renomear o ambiente conserta os pins que apontam para ele. Guardar uma
   * cópia no momento em que o destino é escolhido criaria duas versões do mesmo
   * nome, e a desatualizada seria justamente a que o visitante lê.
   */
  private rotuloDo(hotspot: { label?: string; targetId: string }): string {
    const proprio = hotspot.label?.trim();
    if (proprio) return proprio;
    return this.panoramas.find((p) => p.id === hotspot.targetId)?.roomName ?? '';
  }

  private clearHotspots() {
    for (const sprite of this.hotspotSprites) {
      this.scene.remove(sprite);
      (sprite.material as THREE.SpriteMaterial).map?.dispose();
      sprite.material.dispose();
    }
    this.hotspotSprites = [];
    this.hotspotTargetMap.clear();
  }

  /**
   * O pin que o visitante vê, com a MESMA identidade do pin do wizard.
   *
   * Era uma pílula branca com seta preta, enquanto o corretor marca os pontos
   * numa etapa cujo pin é escuro com dot no accent — duas linguagens para
   * a mesma coisa, e quem monta o tour não reconhecia o que tinha publicado.
   *
   * As cores saem dos tokens `--tw-pin-bg` e `--tw-brand` lidos do documento, e
   * não de hex copiado. Isto aqui é canvas, não CSS: ler a fonte é a única
   * forma de não virar uma terceira cópia da identidade, que é o tipo de
   * duplicação que já custou um bug de eixo neste mesmo arquivo. Os fallbacks
   * cobrem o caso de a folha do wizard não estar carregada.
   */
  private createHotspotSprite(label: string): THREE.Sprite {
    // Desenha em coordenadas lógicas de 256×96 e guarda o dobro de texels.
    //
    // O sprite ocupa ~280px FÍSICOS numa tela de celular (14° de largura num
    // FOV horizontal de ~39°, a 2× de pixel ratio). Uma textura de 256 seria
    // ampliada justo onde mora o texto. 512 cobre isso com folga; acima disso
    // o mipmap devolve o borrão que a supera­mostragem tinha comprado, porque
    // o sprite passa a ser minificado demais.
    const ESCALA = 2;
    const L = 256;
    const A = 96;

    const canvas = document.createElement('canvas');
    canvas.width = L * ESCALA;
    canvas.height = A * ESCALA;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(ESCALA, ESCALA);

    const raiz = getComputedStyle(document.documentElement);
    const token = (nome: string, padrao: string) =>
      raiz.getPropertyValue(nome).trim() || padrao;
    const acento = token('--tw-pin-accent', '#2dd4bf');

    // Halo escuro por fora, antes de tudo. Uma borda vermelha sobre um teto
    // branco ou uma parede clara desaparece; o halo é o que dá silhueta sobre
    // foto QUALQUER, que é a condição real deste pin — ele flutua sobre uma
    // imagem que ninguém controla.
    ctx.save();
    ctx.shadowColor = token('--tw-pin-halo-canvas', 'rgba(0, 0, 0, 0.55)');
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.roundRect(10, 10, L - 20, A - 20, (A - 20) / 2);
    ctx.fillStyle = token('--tw-pin-bg-canvas', 'rgba(11, 18, 32, 0.95)');
    ctx.fill();
    ctx.restore();

    // A borda é o accent, e é ela que faz o pin ser notado de longe.
    //
    // A alternativa era pintar a PÍLULA inteira com o accent. Continua
    // recusada, mas o motivo mudou com a paleta: com a Rausch o argumento era
    // de contraste (branco sobre #ff385c dava 3,5:1, abaixo do 4,5:1 da WCAG);
    // com o azul ARP VISION #0454ed são 6,01:1 e esse argumento cai. O que não cai é o
    // outro: atrás deste pin há uma FOTO que ninguém controla, e um bloco de
    // cor chapada compete com ela em vez de se destacar dela. Branco sobre esta
    // pílula escura dá ~17:1 em qualquer parede. Ver §11 das notas do sprint.
    ctx.beginPath();
    ctx.roundRect(10, 10, L - 20, A - 20, (A - 20) / 2);
    ctx.strokeStyle = acento;
    ctx.lineWidth = 5;
    ctx.stroke();

    // O dot, maior que antes: é a única mancha cheia do accent.
    ctx.beginPath();
    ctx.arc(52, A / 2, 13, 0, Math.PI * 2);
    ctx.fillStyle = acento;
    ctx.fill();

    if (label) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 28px "Inter Variable", Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      // Reticências de verdade. O `maxWidth` do `fillText` ESPREME a fonte para
      // caber, e um nome comprido sai condensado e ilegível; o pin do wizard
      // corta com ellipsis, e aqui é a mesma promessa.
      ctx.fillText(this.comReticencias(ctx, label, L - 78 - 20), 78, A / 2 + 1);
    }

    const texture = new THREE.CanvasTexture(canvas);
    // SEM isto o pin sai lavado, e foi o que apareceu no celular: o renderer
    // trabalha com `outputColorSpace = 'srgb'`, então uma textura que não se
    // declara sRGB é lida como se fosse linear e convertida de novo na saída.
    // Medido à época, com a marca ainda em #ff385c: ela chegava à tela como
    // #ff81a2, um rosa claro, e a pílula #101218 como #474b56, um cinza médio.
    // A cor mudou, o mecanismo não. A foto já fazia isso certo desde sempre
    // (`loadPanorama`); só o sprite ficou de fora.
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(material);
    // Mantém a proporção 8:3 do canvas. 1,5× o tamanho anterior: a 80×30 o pin
    // dava ~28px de altura no celular, e o piso de alvo da WCAG é 44.
    sprite.scale.set(120, 45, 1);
    return sprite;
  }

  /** Corta o texto e põe reticências, como o `text-overflow` do pin HTML. */
  private comReticencias(
    ctx: CanvasRenderingContext2D,
    texto: string,
    limite: number,
  ): string {
    if (ctx.measureText(texto).width <= limite) return texto;

    let corte = texto.length;
    while (corte > 1 && ctx.measureText(`${texto.slice(0, corte)}…`).width > limite) {
      corte--;
    }
    return `${texto.slice(0, corte)}…`;
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    // Encostar na foto fecha a lista. Ela cobre um pedaço da imagem, e quem
    // volta a mexer no panorama já decidiu que não era dali que queria sair —
    // exigir um segundo toque no botão para fechá-la seria cobrar pedágio.
    this.navAberta = false;
    this.pointerDownAt = { x: event.clientX, y: event.clientY };
  };

  /**
   * Decide se o `click` que vem a seguir é clique ou sobra de arrasto.
   *
   * O OrbitControls gira no arrasto, e o browser dispara `click` ao soltar
   * porque o down e o up caíram no mesmo elemento. Sem esta trava, girar o
   * panorama em `editMode` criaria um hotspot a cada solta.
   */
  private readonly onPointerUp = (event: PointerEvent) => {
    const start = this.pointerDownAt;
    this.pointerDownAt = null;
    if (!start) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    this.suppressNextClick = Math.hypot(dx, dy) > DRAG_SLOP_PX;
  };

  private readonly onCanvasClick = (event: MouseEvent) => {
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }

    if (this.editMode) {
      const uv = this.uvAt(event.clientX, event.clientY);
      if (uv) {
        this.hotspotPlaced.emit({ positionX: uv.u, positionY: uv.v });
      }
      return;
    }

    if (this.hotspotSprites.length > 0) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const intersects = this.raycaster.intersectObjects(this.hotspotSprites);
      if (intersects.length > 0) {
        const sprite = intersects[0].object as THREE.Sprite;
        const targetId = this.hotspotTargetMap.get(sprite);
        if (targetId) {
          this.navigateTo(targetId);
          return;
        }
      }
    }

    // Sobrou o toque na foto. Sai por último, depois de o hotspot ter tido a
    // chance de responder: um toque que troca de cômodo não pode TAMBÉM
    // esconder a interface.
    this.canvasTapped.emit();
  };

  private readonly onWindowResize = () => {
    const container = this.canvasContainer.nativeElement;
    this.camera.aspect = container.clientWidth / container.clientHeight;
    this.camera.updateProjectionMatrix();
    // O DPR também muda aqui, e não só no primeiro desenho: arrastar a janela
    // de um monitor comum para um Retina dispara `resize` com um
    // `devicePixelRatio` novo. Sem reaplicar, a tela boa herda a resolução da
    // ruim e não há nada na interface que explique por quê.
    this.renderer.setPixelRatio(this.pixelRatioAlvo());
    this.renderer.setSize(container.clientWidth, container.clientHeight);
  };

  /**
   * Carrega a imagem nova na esfera de cima e começa a dissolvência.
   *
   * Falhar aqui não faz nada visível de propósito: a imagem que está na tela
   * continua correta e utilizável, e um erro no meio da captura por causa de
   * um refinamento seria pior que o refinamento não acontecer.
   */
  private revelar(): void {
    const url = this.revealUrl;
    if (!url || url === this.urlRevelada) return;

    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (texture) => {
        // Chegou depois de o input já ter mudado de novo, ou depois de uma
        // troca de cômodo: a textura recém-carregada não serve mais.
        if (this.revealUrl !== url) {
          texture.dispose();
          return;
        }

        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

        const material = this.revealMesh.material as THREE.MeshBasicMaterial;
        material.map?.dispose();
        material.map = texture;
        material.opacity = 0;
        material.needsUpdate = true;
        this.revealMesh.visible = true;
        this.urlRevelada = url;

        // Quem pediu menos movimento recebe a imagem nova, sem a travessia.
        if (prefereMenosMovimento()) {
          this.concluirRevelacao();
          return;
        }
        this.revelacaoInicio = performance.now();
      },
      undefined,
      () => undefined,
    );
  }

  /** Passa a imagem revelada para a esfera de baixo e recolhe a de cima. */
  private concluirRevelacao(): void {
    const deCima = this.revealMesh.material as THREE.MeshBasicMaterial;
    const deBaixo = this.sphereMesh.material as THREE.MeshBasicMaterial;
    const texture = deCima.map;

    if (texture) {
      // A textura MUDA DE DONO aqui. A antiga da esfera de baixo é solta; a de
      // cima perde a referência sem `dispose()`, senão a imagem que acabou de
      // aparecer some junto.
      deBaixo.map?.dispose();
      deBaixo.map = texture;
      deBaixo.needsUpdate = true;
      deCima.map = null;
    }

    deCima.opacity = 0;
    this.revealMesh.visible = false;
    this.revelacaoInicio = null;
  }

  /** Descarta uma revelação em curso ou já carregada, soltando a textura. */
  private cancelarRevelacao(): void {
    const material = this.revealMesh?.material as THREE.MeshBasicMaterial | undefined;
    if (material) {
      material.map?.dispose();
      material.map = null;
      material.opacity = 0;
    }
    if (this.revealMesh) this.revealMesh.visible = false;
    this.revelacaoInicio = null;
    this.urlRevelada = null;
  }

  private animate() {
    this.animationFrameId = requestAnimationFrame(() => this.animate());

    if (this.revelacaoInicio !== null) {
      const decorrido = performance.now() - this.revelacaoInicio;
      const t = Math.min(1, decorrido / PanoramicViewerComponent.DURACAO_REVELACAO_MS);
      // `t*t*(3-2t)`: começa e termina devagar. Uma rampa linear faz a imagem
      // nova "aparecer" de repente no primeiro quadro em que passa a ser
      // percebida, e é justamente a transição que se quer que seja vista.
      (this.revealMesh.material as THREE.MeshBasicMaterial).opacity =
        t * t * (3 - 2 * t);
      if (t >= 1) this.concluirRevelacao();
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    for (const callback of this.frameCallbacks) callback();
  }
}

/**
 * Duplicado de `tour-wizard/hotspots/media.ts` de propósito: este componente é
 * usado fora do wizard (inner-view, embed) e não pode depender de um módulo de
 * lá. São três linhas.
 */
function prefereMenosMovimento(): boolean {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

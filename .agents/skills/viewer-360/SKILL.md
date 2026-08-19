---
name: viewer-360
description: Guia para trabalhar com o viewer panorâmico Three.js, projeção de hotspots, captura 360° e stitching. Armadilhas mapeadas e soluções conhecidas.
---

# Skill: Viewer 360° e Captura

## Arquitetura do Viewer

`PanoramicViewerComponent` (`components/panoramic-viewer/`):
- Three.js: `SphereGeometry` + `MeshBasicMaterial` com textura equirretangular
- `OrbitControls` para navegação (arrastar/girar)
- `editMode`: habilita clique na esfera para criar hotspots

### Modos de uso

| Modo | Onde | Hotspots | Navegação de ambientes |
|---|---|---|---|
| Normal | embed, inner-view | Sprites Three.js | Lista de ambientes (pílula + dropdown) |
| Edit | tour-wizard etapa 2 | Overlay HTML | Scene rail |

---

## Convenção de Coordenadas

### UV do Three.js vs positionX/positionY do backend

```
SphereGeometry:  uv.y = 1 - v_geom    (v_geom = 0 no polo de CIMA → uv.y = 1 no topo)
onCanvasClick:   positionY = 1 - uv.y  (topo → positionY = 0)
```

**Portanto:**
- `positionY = 0` = polo norte (topo)
- `positionY = 1` = polo sul (fundo)
- Conversão para theta: `theta = positionY * PI` (medido de +Y)

### ⚠️ BUG HISTÓRICO (corrigido em f7803a4)
```typescript
// ERRADO (era o bug):
const theta = (1 - hotspot.positionY) * Math.PI;

// CORRETO:
const theta = hotspot.positionY * Math.PI;
```

O teste que garante isso: `hotspot-projection.spec.ts` → "ida e volta com o clique do viewer"

---

## Projeção 3D → Tela (overlay HTML)

O overlay de pins do wizard projeta hotspots para coordenadas CSS:

```typescript
// hotspot-projection.ts
export function hotspotToWorld(u: number, v: number, radius: number): Vector3 {
  const theta = v * Math.PI;           // 0=topo, PI=fundo
  const phi = u * 2 * Math.PI - Math.PI; // -PI a PI, 0=frente
  return new Vector3(
    -radius * Math.sin(theta) * Math.sin(phi),
     radius * Math.cos(theta),
    -radius * Math.sin(theta) * Math.cos(phi),
  );
}
```

A cada frame de render:
1. Calcular posição 3D do hotspot
2. `vector.project(camera)` → coordenadas NDC (-1 a 1)
3. Converter para pixels do canvas
4. Aplicar `transform: translate(x, y)` no pin HTML
5. `visibility: hidden` se o ponto estiver atrás da câmera (z > 1)

---

## Armadilhas Mapeadas

### 1. Pixel ratio (DPR)
**Problema**: sem `setPixelRatio`, o renderer usa DPR 1 — renderiza em 11% dos pixels num celular DPR 3.
**Solução**: `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))` — reaplicar no resize.

### 2. Contexto WebGL vazando
**Problema**: `dispose()` não solta o contexto. Browser tem ~16 vivos. O wizard monta/desmonta a cada troca de etapa.
**Solução**: `renderer.forceContextLoss()` ANTES de `renderer.dispose()`.

### 3. Textura sem dispose
**Problema**: ~128 MiB de VRAM por navegação se não der dispose na textura anterior.
**Solução**: `oldTexture.dispose()` antes de `material.map = newTexture`.

### 4. CanvasTexture sem colorSpace
**Problema**: sprite desenhado com `#ff385c` exibia `#ff81a2` (rosa claro).
**Causa**: sem `texture.colorSpace = SRGBColorSpace`, a textura é lida como linear e convertida de novo na saída.
**Solução**: `texture.colorSpace = THREE.SRGBColorSpace` em toda CanvasTexture.

### 5. Clique no fim do arrasto
**Problema**: OrbitControls gira no arrasto e o browser dispara `click` ao soltar → criava hotspot a cada giro.
**Solução**: medir deslocamento no `pointerup`, engolir clique acima de 6px de folga.

### 6. OrbitControls + testes
**Problema**: `setPointerCapture` no `pointerdown` falha com `pointerId` sintético.
**Solução**: neutralizar a chamada no TestBed — exemplo em `panoramic-viewer.component.spec.ts`.

### 7. Render loop na zona Angular
**Problema**: `animate()` nasce dentro da zona → change detection 60×/s.
**Solução**: `zone.runOutsideAngular(() => this.animate())` — cuidado: verificar se o inner-view depende de CD após cada frame.

---

## Captura 360° Guiada

`Capture360Component` (`components/capture-360/`):
- Usa giroscópio para guiar o corretor em uma rotação completa
- Captura N fotos individuais com orientação (quaternion)
- Faz stitching no browser para gerar o equirretangular
- Preview com opção de refazer
- Nomear o ambiente no preview (chips de sugestão)

### Geometria da captura
- `fittedVfovDeg`: campo vertical ajustado da câmera
- `bandTopDeg` / `bandBottomDeg`: latitudes limites da faixa fotografada
- Nadir (fundo) e zênite (topo) ficam sem foto → tratamento IA completa

### CaptureFrames
Cada foto individual é guardada como `CaptureFrame`:
- `index`: ordem do disparo
- `imageData`: JPEG base64
- `qx, qy, qz, qw`: quaternion de orientação
- `@@unique([panoramaId, index])`: reenvio não duplica

---

## Tratamento de Panoramas com IA

Alvo: corrigir paralaxe (objeto duplicado na emenda) e degrau na junção.

### Fluxo
1. `POST /virtual-tours/:id/montar` dispara (depois de as fotos originais subirem)
2. Modelo recebe equirect + fotos originais como referência
3. Devolve panorama reparado em 3840×1920
4. Resultado vai para `treatedImageData` (original preservado em `imageData`)
5. `GET /virtual-tours/:id/montagem` alimenta tela de espera

### Invariantes
- Original NUNCA sobrescrito
- Reverter = apagar `treatedImageData`
- Trocar foto do cômodo (`PATCH /panoramas/:id`) limpa o tratamento
- Emenda da volta é reconciliada por aritmética (`volta.ts`), não por instrução ao modelo

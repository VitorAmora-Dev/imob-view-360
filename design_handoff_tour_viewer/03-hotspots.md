# 03 · Hotspot de piso (estilo Street View)

O hotspot de navegação entre cenas é um **disco elíptico deitado no chão** com um chevron
apontando para frente e uma plaquinha com o nome do destino. Referência visual: as setas de
piso do Google Street View.

---

## Geometria

O truque é aplicar perspectiva CSS a um elemento quadrado. **Dois elementos aninhados:**

```html
<!-- externo: só a flutuação -->
<div class="hotspot-bob">
  <!-- interno: só a perspectiva. NUNCA junte os dois no mesmo elemento -->
  <div class="hotspot-disc">
    <span class="hotspot-halo"></span>
    <span class="hotspot-ring"></span>   <!-- só no hotspot ativo -->
    <svg class="hotspot-chevron">…</svg>
  </div>
</div>
<span class="hotspot-label">ESCRITÓRIO</span>
```

```css
.hotspot-bob   { animation: pin-bob 3.6s ease-in-out infinite; }
.hotspot-disc  { position: relative; width: 88px; height: 88px;
                 transform: perspective(190px) rotateX(62deg);
                 transform-origin: center center; }
```

> **Armadilha conhecida:** se `animation: pin-bob` e `transform: perspective(...) rotateX(...)`
> ficarem no mesmo elemento, a keyframe (que anima `transform`) descarta a perspectiva e o
> disco vira um círculo chapado de frente para a câmera. Separe sempre.

Resultado renderizado: 88×88 vira aproximadamente **88 × 41px** (≈ `88·cos 62°`).

| Contexto | Lado do disco | `perspective` | `rotateX` |
|---|---|---|---|
| Mobile — ativo | 88px | 190px | 62deg |
| Desktop — ativo | 124px | 270px | 62deg |
| Desktop — secundário | 96px | 210px | 62deg |

## Camadas do disco (todas `position:absolute; inset:0; border-radius:50%`)

**1 · Halo**
```css
background: radial-gradient(circle at 50% 40%,
            rgba(47,227,194,.34), rgba(47,227,194,.12) 62%, rgba(47,227,194,0) 74%);
border: 1.5px solid rgba(255,255,255,.45);   /* 1.8px no desktop */
box-shadow: 0 0 24px rgba(47,227,194,.28);   /* 30px no desktop */
```

**2 · Anel de pulso** — apenas no destino em destaque
```css
border: 1.5px solid var(--accent);
animation: pin-ring 2.6s ease-out infinite;
/* @keyframes pin-ring { 0% {transform:scale(.6); opacity:.5} 100% {transform:scale(1.5); opacity:0} } */
```

**3 · Chevron** — SVG `viewBox="0 0 88 88"`, ocupando o disco inteiro:
```
<path d="M44 26 66 50l-9 5-13-14-13 14-9-5z" fill="rgba(255,255,255,.92)" />
```
Ele aponta para o topo do disco; como o disco está deitado, isso lê como "para frente".

**4 · Plaquinha de rótulo** — fora do wrapper de perspectiva, `gap:8px` abaixo do disco
- Mobile: padding `6px 13px`, radius 9px, 11.5px/800, `letter-spacing:.06em`, uppercase
- Desktop: padding `8px 16px`, radius 10px, 13px/800
- `background: rgba(9,18,29,.9)`, `border: 1px solid rgba(255,255,255,.15)`, `blur(8px)`,
  `box-shadow: shadow-float`

## Hierarquia entre hotspots

| Tipo | Halo | Anel | Chevron | Rótulo | Quando usar |
|---|---|---|---|---|---|
| **Ativo / sugerido** | Gradiente accent + glow | Sim | `rgba(255,255,255,.92)` | `rgba(9,18,29,.92)`, texto branco | O caminho principal a partir desta cena |
| **Secundário** | `rgba(255,255,255,.2 → 0)`, sem glow | Não | `rgba(255,255,255,.8)` | `rgba(9,18,29,.85)`, texto `.88` | Demais destinos; `opacity:.88` no conjunto |

Regra de produto: **no máximo um hotspot ativo por cena.** Se o tour não definir um caminho
principal, todos ficam secundários.

## Integração com o viewer 360º

No protótipo os hotspots estão em `left/top` percentuais. Em produção:

1. Cada hotspot é armazenado como `{ id, targetSceneId, label, yaw, pitch, kind: 'primary'|'secondary' }`.
2. O viewer (Pannellum/Marzipano/three.js) projeta yaw/pitch → coordenada de tela a cada frame.
3. Posicione o wrapper com `transform: translate3d(x, y, 0)` e `will-change: transform` —
   **não** anime `left/top`.
4. **Escala por distância:** interpole o lado do disco entre 64px (horizonte) e 124px
   (próximo ao observador) usando o pitch, para reforçar a leitura de profundidade.
5. Oculte (`display:none`) hotspots fora do frustum — não deixe elementos posicionados fora
   da viewport.
6. Se o viewer já projetar em WebGL, avalie desenhar o disco como sprite na cena 3D em vez de
   DOM; visualmente as specs são as mesmas.

## Acessibilidade

- Cada hotspot é um `<button>` com `aria-label="Ir para {nome da cena}"`.
- Ordem de tabulação: hotspots depois dos controles de chrome.
- Devem ser alcançáveis por teclado mesmo quando o viewer é canvas.
- Alvo de toque efetivo ≥ 44px, incluindo a plaquinha.

# Handoff: Tela de visualização de tour (mobile + desktop)

> Pacote de handoff gerado a partir do protótipo `Tour Viewer Refatorado.dc.html`.
> Público-alvo: desenvolvedor(a) usando Claude Code para implementar no codebase real.

---

## Overview

Refatoração da tela de **visualização de um tour virtual 360º** do ponto de vista do
**dono do tour** (corretor / imobiliária logado), não do visitante final.

Problemas do estado atual que a refatoração resolve:

1. No mobile, as ações de gestão (editar, incorporar, apagar) viviam como ícones de ~32px
   no topo — fora da zona de alcance do polegar e sem rótulo.
2. Ações de **visualização** (ocultar interface) estavam misturadas com ações de
   **ciclo de vida do tour** (apagar), na mesma barra, sem hierarquia.
3. `Apagar` ficava a um toque de distância, sem confirmação proporcional ao dano.
4. Havia uma barra escura inferior sem função clara, ocupando altura útil do panorama.
5. No desktop, seis ícones sem rótulo no topo, misturados à navegação global do produto.

Solução:

- **Mobile:** tab bar inferior de 3 ações — **EDITAR · EMBED · APAGAR** — com alvos de 56px.
- Controles de visualização saem para um botão flutuante à direita (**Ocultar interface**).
- Navegação entre cenas via pill no topo + faixa de miniaturas acima da tab bar.
- Todas as ações destrutivas e o embed acontecem em **bottom sheets**.
- **Desktop:** duas camadas explícitas — topo = navegação do produto; rodapé direito =
  ações deste tour, com rótulo em texto e `Apagar` isolado por um divisor.

---

## About the Design Files

Os arquivos deste bundle são **referências de design feitas em HTML** — protótipos que
mostram a aparência e o comportamento pretendidos. **Não são código de produção para
copiar e colar.**

A tarefa é **recriar estes designs no ambiente já existente do codebase alvo**
(React, Vue, Next, React Native, etc.), usando os padrões, componentes e bibliotecas
já estabelecidos ali (sistema de rotas, biblioteca de ícones, wrapper de modal/sheet,
tokens de tema). Se ainda não existir um ambiente definido, escolha o framework mais
adequado ao projeto e implemente lá.

O protótipo usa estilos inline por uma restrição da ferramenta de design — **não replique
isso**. Traduza para o mecanismo de estilo do projeto (CSS Modules, Tailwind,
styled-components, StyleSheet…) e para os tokens listados em
[`01-design-tokens.md`](./01-design-tokens.md).

O panorama e as miniaturas do protótipo são recortes de uma captura de tela do produto
atual, usados só como placeholder visual. Em produção vêm do renderizador 360º real.

---

## Fidelity

**Alta fidelidade (hifi).**

Cores, tipografia, espaçamentos, raios, alturas de alvo e microinterações estão
especificados com valores finais. Recrie pixel-perfect usando as bibliotecas do codebase.

Exceções conscientes (baixa fidelidade, precisam de decisão do time):

- O panorama em si é uma imagem estática no protótipo; em produção é o viewer 360º
  (Pannellum / Marzipano / three.js — o que já estiver em uso).
- Os hotspots estão posicionados em coordenadas CSS fixas. Em produção eles são
  projetados pelo viewer a partir de coordenadas esféricas (yaw/pitch) — ver
  [`03-hotspots.md`](./03-hotspots.md).
- Números do conteúdo ("6 cenas", nomes de cômodos, URL do embed) são fictícios.

---

## Índice da documentação

| Arquivo | Conteúdo |
|---|---|
| [`01-design-tokens.md`](./01-design-tokens.md) | Cores, tipografia, espaçamento, raios, sombras, blur, motion |
| [`02-mobile.md`](./02-mobile.md) | Tela mobile: layout, cada componente, medidas exatas |
| [`03-hotspots.md`](./03-hotspots.md) | O hotspot de piso estilo Street View (geometria + integração com o viewer) |
| [`04-sheets.md`](./04-sheets.md) | Bottom sheets: Cenas, Embed, Apagar, Gerenciar |
| [`05-desktop.md`](./05-desktop.md) | Tela desktop e regras de responsividade |
| [`06-state-behavior.md`](./06-state-behavior.md) | Estado, transições, dados, acessibilidade, checklist de QA |

Capturas de tela em [`screens/`](./screens) — ver tabela em
[`06-state-behavior.md`](./06-state-behavior.md#capturas-de-referência).

---

## Assets

| Arquivo | O que é | Origem |
|---|---|---|
| `assets/pano.png` | Panorama de fundo | Recorte de screenshot do produto atual — **placeholder** |
| `assets/thumb-1..4.png` | Miniaturas de cena | Recortes do mesmo screenshot — **placeholder** |
| Ícones | Todos são SVG inline stroke, 24×24 viewBox, `stroke-width` 1.8–2.4, `stroke-linecap="round"` | Desenhados no protótipo; substituir pela biblioteca de ícones do codebase (Lucide/Feather têm equivalentes 1:1) |

Nenhuma fonte proprietária: **Manrope** (400/500/600/700/800) e **JetBrains Mono** (400/500),
ambas Google Fonts / SIL OFL.

---

## Files

| Arquivo | Descrição |
|---|---|
| `prototype/Tour Viewer Refatorado.dc.html` | Protótipo interativo completo (mobile + desktop lado a lado) |
| `prototype/assets/` | Imagens usadas pelo protótipo |
| `screens/*.png` | Capturas de cada estado |

O protótipo abre direto no navegador. Os botões abaixo do aparelho ("Estado inicial",
"Cenas", "Embed", "Apagar", "Gerenciar") são atalhos de demonstração — **não fazem parte
do produto**, servem só para inspecionar cada sheet. As colunas de texto à direita de cada
tela são notas de rationale, também fora do produto.

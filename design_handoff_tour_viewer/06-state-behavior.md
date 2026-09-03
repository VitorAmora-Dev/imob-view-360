# 06 · Estado, comportamento e QA

## Estado da tela

```ts
type SheetKind = 'scenes' | 'embed' | 'delete' | 'manage' | null;

interface TourViewerState {
  currentSceneIndex: number;   // padrão 0 (ou a cena inicial definida no tour)
  sheet: SheetKind;            // padrão null — só um sheet por vez
  chromeVisible: boolean;      // padrão true — false = modo imersivo
  toast: string | null;        // mensagem efêmera, 2200ms
  embedFormat: 0 | 1 | 2;      // 0 Responsivo · 1 16:9 · 2 Quadrado
  embedShowControls: boolean;  // padrão true
  railCollapsed: boolean;      // só desktop, padrão false
}
```

## Transições

| Gatilho | Efeito |
|---|---|
| Toque na pill de cena / "Ver todas" | `sheet = 'scenes'` |
| Toque em miniatura da faixa | `currentSceneIndex = i` (sheet permanece fechado) |
| Toque em card dentro do sheet Cenas | `currentSceneIndex = i`, `sheet = null` |
| Toque em hotspot | `currentSceneIndex = destino` |
| **EDITAR** | Navega para a rota do editor |
| **EMBED** | `sheet = 'embed'` |
| **APAGAR** | `sheet = 'delete'` — nunca executa direto |
| "Apagar tour" (dentro do sheet) | Chama a API; em sucesso navega para a listagem |
| "⋯" | `sheet = 'manage'` |
| Botão do olho | `chromeVisible = !chromeVisible` |
| Copiar código / link | Clipboard + `toast`; sheet continua aberto |
| Scrim, arrasto para baixo, `Esc` | `sheet = null` |

**Invariantes**
1. `chromeVisible === false` ⇒ a faixa de cenas, a tab bar, o header (menos o voltar),
   a pill e **os hotspots** não são renderizados.
2. `sheet !== null` ⇒ a faixa de cenas fica oculta (evita duas listas simultâneas).
3. Nunca dois sheets abertos.
4. Ação destrutiva sempre passa por confirmação.

## Dados necessários

```ts
interface Tour {
  id: string;
  name: string;
  publicSlug: string;         // monta arpvision.app/t/{slug}
  scenes: Scene[];
  initialSceneId: string;
  pendingChanges: number;     // alimenta "N cenas editadas desde a última publicação"
}

interface Scene {
  id: string;
  name: string;
  thumbUrl: string;           // recomendado 292×184 (2x de 146×92)
  panoramaUrl: string;
  hotspots: Hotspot[];
}

interface Hotspot {
  id: string;
  targetSceneId: string;
  label: string;              // renderizado em UPPERCASE via CSS, não no dado
  yaw: number;                // graus
  pitch: number;              // graus
  kind: 'primary' | 'secondary';
}
```

**Endpoints esperados**
- `GET /tours/:id` — tour + cenas + hotspots
- `DELETE /tours/:id` — exclusão (idealmente com `?soft=true`)
- `POST /tours/:id/publish` — publicar alterações

## Estados que o protótipo não cobre — implementar

| Estado | Tratamento sugerido |
|---|---|
| **Carregando o panorama** | Skeleton escuro (`#0B1420`) + spinner accent centralizado; chrome já visível |
| **Carregando miniaturas** | Bloco `#0B1420` com shimmer sutil, mesma borda e raio |
| **Erro ao carregar cena** | Estado vazio centralizado + botão "Tentar de novo" (ghost) |
| **Tour sem cenas** | Esconder faixa e pill; tab bar mantém só EDITAR e APAGAR |
| **Apagando** | Botão em loading, texto "Apagando…", sheet trava (sem fechar por scrim) |
| **Falha ao apagar** | Toast de erro em `danger` com o mesmo layout do toast de sucesso |
| **Offline** | Faixa de aviso 32px abaixo do header, fundo `rgba(255,176,32,.15)` |
| **Sem permissão de edição** | Tab bar com só EMBED; ocultar EDITAR e APAGAR (não desabilitar) |

## Acessibilidade

- Contraste: rótulos da tab bar sobre `tabbar-bg` ≥ 4.5:1; `accent-ink` sobre `accent` ≈ 11:1.
- Alvos ≥ 44px; tab bar com 56px.
- Todo botão só-ícone precisa de `aria-label`.
- Botão do olho: `aria-pressed` + label que muda ("Ocultar interface" / "Mostrar interface").
- Sheets: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` no título, focus trap,
  foco devolvido ao gatilho no fechamento.
- Faixa/rail de cenas: `role="tablist"`, cada miniatura `role="tab"` com `aria-selected`.
- `prefers-reduced-motion: reduce` desliga `pin-bob` e `pin-ring`.
- Modo imersivo não pode ser a única forma de chegar a nada — é atalho, não navegação.

## Capturas de referência

| Arquivo | Estado |
|---|---|
| `screens/01-mobile-default.png` | Mobile em repouso — header, pill, hotspot, faixa de cenas, tab bar |
| `screens/02-mobile-cenas.png` | Sheet **Cenas** aberto (grade 2 colunas, badge ATUAL) |
| `screens/03-mobile-embed.png` | Sheet **Incorporar** (formatos, código, toggle, ações) |
| `screens/04-mobile-apagar.png` | Sheet **Apagar** (ícone, aviso, botões empilhados) |
| `screens/05-mobile-gerenciar.png` | Sheet **Gerenciar** (lista com chevrons) |
| `screens/06-mobile-imersivo.png` | Modo imersivo — só voltar e o botão do olho |
| `screens/07-desktop.png` | Desktop completo, 1440×860 |

## Checklist de QA

- [ ] Tab bar fixa, sem sobrepor `env(safe-area-inset-bottom)`
- [ ] Alvos da tab bar com 56px de altura reais
- [ ] APAGAR nunca executa sem confirmação
- [ ] Modo imersivo esconde **tudo**, menos voltar e o próprio botão
- [ ] Hotspot renderiza como **elipse deitada**, não círculo de frente (checar que `rotateX` não foi engolido pela animação)
- [ ] Só um hotspot com anel de pulso por cena
- [ ] Faixa de cenas rola na horizontal **sem scrollbar visível** e sem cortar legendas
- [ ] Cena atual marcada com borda accent na faixa, no rail e no sheet
- [ ] Código de embed muda com o formato selecionado
- [ ] Toast some em 2200ms e não bloqueia toques
- [ ] Sheet fecha por scrim, arrasto e `Esc`; foco volta ao gatilho
- [ ] Scrims não bloqueiam o arrasto do panorama
- [ ] Abaixo de 768px o layout desktop dá lugar ao mobile por completo
- [ ] `prefers-reduced-motion` respeitado

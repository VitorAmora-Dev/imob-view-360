---
name: design-system
description: Referência completa do design system Arp Vision — paleta, tokens, tipografia, espaçamento, regras de uso, e tema imersivo do tour 360°.
---

# Skill: Design System — Arp Vision

## Identidade Visual

A identidade Arp Vision substituiu a paleta Airbnb Rausch. Tipografia, espaçamento, raios e componentes do documento original (DESIGN.md) **continuam valendo** — só a paleta mudou.

---

## Paleta de Cores

### Cores da marca (proporção 60/30/10)

| Token | Hex | CSS Variable | Uso |
|---|---|---|---|
| `brand-blue-dark` | `#1D4ED8` | `--brand-primary-700` | Hover/pressed do azul; texto azul sobre fundo claro |
| `brand-blue` | `#2563EB` | `--brand-primary` | **Cor principal.** Logo, links, CTAs, destaques |
| `brand-blue-soft` | `#DBEAFE` | `--brand-primary-100` | Fundo suave: badges, estados selecionados |
| `brand-teal-dark` | `#0F766E` | `--brand-accent-700` | Texto/ícone teal sobre branco; botão teal |
| `brand-teal` | `#14B8A6` | `--brand-accent` | **Accent.** Barras de progresso, badges concluídos |
| `brand-teal-soft` | `#CCFBF1` | `--brand-accent-100` | Fundo suave teal |

### Regra de uso
- **60% neutro**: fundos claros, texto
- **30% azul**: identidade — presente mas não dominante
- **10% teal**: pontuação, estados concluídos. NUNCA como botão primário

### Semântica no projeto
- **Azul = "o que eu posso fazer"** (ações, CTAs, links)
- **Teal = "o que já está feito"** (etapa concluída, barra de progresso, badge "Capa")
- Teal proibido em: botão primário, FAB, busca, links, anel de foco, ação destrutiva

---

## Neutros

| Token | Hex | Uso |
|---|---|---|
| `text-strong` | `#0F172A` | Texto principal, títulos |
| `text-secondary` | `#334155` | Texto de apoio, subtítulos |
| `text-muted` | `#64748B` | Legendas, placeholders |
| `border` | `#CBD5E1` | Bordas, divisores, contornos de input |
| `bg-section` | `#F1F5F9` | Fundo de seção |
| `bg-base` | `#F8FAFC` | Fundo geral |
| `white` | `#FFFFFF` | Cards, superfícies elevadas |

---

## Status (APENAS feedback funcional, NUNCA como cor de marca)

| Token | Base | Text (-700) | Soft | Uso |
|---|---|---|---|---|
| `success` | `#16A34A` | (dá 3.30:1 sobre branco — usar -700 para texto) | — | Sucesso, disponível |
| `warning` | `#F59E0B` | (dá 2.15:1 — usar -700) | — | Avisos, pendências |
| `error` | `#DC2626` | `#B91C1C` | — | Erros, ações destrutivas |

**IMPORTANTE**: cores de status sempre acompanhadas de ícone ou texto. Nunca só a cor (daltônicos).

---

## Tema Imersivo (tour 360°)

| Token | Hex | Uso |
|---|---|---|
| `tour-bg` | `#0B1220` | Fundo do viewer |
| `tour-surface` | `#1E293B` | Painéis flutuantes sobre fundo escuro |
| `tour-teal-glow` | `#2DD4BF` | Accent brilhante: botões do tour |
| `tour-text` | `#E2E8F0` | Texto sobre fundo escuro |

**Escopo restrito**: vale APENAS dentro do viewer 360° (embed e inner-view). Todo o resto usa tema claro. Não é dark mode.

---

## Contraste WCAG AA — Erros comuns

| Situação | ❌ Errado | ✅ Correto |
|---|---|---|
| Botão teal com texto branco | `bg: #14B8A6, color: white` (3.2:1) | `bg: #0F766E, color: white` (5.5:1) |
| Texto teal sobre branco | `color: #14B8A6` (2.3:1) | `color: #0F766E` (5.5:1) |
| Botão azul com texto branco | OK para texto grande/bold | Para texto pequeno, usar `#1D4ED8` |

---

## Tipografia

- Font: Inter (fallback de Airbnb Cereal VF)
- Display: 22-28px, weight 500-700
- Body: 16px/400 (md), 14px/400 (sm)
- Headings modestos — a fotografia carrega a hierarquia visual

---

## Espaçamento

Base 4px (com 2px micro-step):
```
xxs: 2px | xs: 4px | sm: 8px | md: 12px | base: 16px
lg: 24px | xl: 32px | xxl: 48px | section: 64px
```

---

## Raios

```
none: 0 | xs: 4px | sm: 8px (botões) | md: 14px (cards)
lg: 20px | xl: 32px | full: 9999px (pills, search bar)
```

---

## Elevação

Uma única sombra:
```css
box-shadow: rgba(0,0,0,0.02) 0 0 0 1px,
            rgba(0,0,0,0.04) 0 2px 6px,
            rgba(0,0,0,0.1) 0 4px 8px;
```
Usada em hover de cards e dropdowns. Sem sombra = 95% das superfícies.

---

## Breakpoints

| Nome | Largura | Mudanças |
|---|---|---|
| Mobile | < 768px | Sheet em vez de painel, stepper compacto |
| Desktop | ≥ 768px | Painel lateral, stepper com rótulos |

No wizard: `max-width: 767px` no SCSS, `TW_MOBILE_QUERY` no TypeScript — **idênticos**.

---

## Checklist de implementação

- [ ] Usar tokens nomeados, nunca hex solto
- [ ] Neutro domina; azul como identidade; teal como pontuação
- [ ] Texto escuro sobre teal claro; teal escuro com texto branco
- [ ] Tema escuro restrito ao viewer 360°
- [ ] Cores de status sempre com ícone
- [ ] Contraste mínimo 4.5:1 (texto normal)
- [ ] Touch targets ≥ 44px

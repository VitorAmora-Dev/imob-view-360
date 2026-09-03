# SPRINT 4 — Notas de encerramento do Tour Viewer

## O que foi entregue

- Chrome mobile com modo imersivo, barra de ações e toast do viewer.
- Sheet **Gerenciar** com publicação condicional, edição das informações,
  compartilhamento com fallback para clipboard e download da cena atual.
- Layout desktop responsivo com `AppHeaderComponent` em overlay, contexto da
  cena e clusters separados de visualização e gestão.
- Estados de carregamento, erro, tour vazio, exclusão, falha, offline e usuário
  sem permissão tratados pelo viewer e pelo store.
- Acessibilidade revisada na faixa de cenas, nos controles somente com ícone,
  no modo imersivo e nos sheets adaptáveis.
- Página Angular antiga do viewer e rota `inner-view-legado` removidas. A URL
  pública `/inner-view-page/:id` foi mantida e agora carrega exclusivamente o
  `TourViewerPage` novo.

## Decisões e ajustes de plano

- A integração partiu de `feature/tour-wizard-edicao`, que já reunia as frentes
  correlacionadas do Sprint 4.
- **Publicar tour** continua exclusivo de `DRAFT`, sem contador de pendências.
- **Configurações do tour** reutiliza o wizard em modo de edição e abre a etapa
  de informações por `?etapa=4`; os demais acessos ao wizard não mudaram.
- O compartilhamento usa a URL pública existente `/embed/:id`, pois o contrato
  atual não fornece `publicSlug`, e registra o sucesso em
  `POST /virtual-tours/:id/shares`.
- `Capture360Component` não é importado pelo viewer novo. Ele permanece apenas
  nos fluxos de captura do wizard e do upload legado, onde ainda é necessário.
- O topo desktop permanece reservado à navegação do produto; gestão do tour
  fica no cluster inferior ou no sheet mobile.

## Checklist de QA do handoff

Itens abaixo conferidos por testes automatizados e auditoria responsiva do
código. A validação tátil final em aparelhos físicos está registrada à parte.

- [x] Tab bar respeita a safe area inferior.
- [x] Alvos da tab bar têm 56 px reais.
- [x] Apagar exige confirmação antes de emitir a ação.
- [x] Imersivo preserva somente voltar e o próprio botão do olho.
- [x] Hotspots mantêm a forma elíptica prevista no handoff.
- [x] Somente o hotspot ativo recebe pulso.
- [x] Faixa de cenas rola horizontalmente sem scrollbar e preserva as legendas.
- [x] Cena atual usa accent na faixa, no rail e no sheet.
- [x] Código de incorporação acompanha o formato selecionado.
- [x] Toast dura 2200 ms e não intercepta ponteiro.
- [x] Sheets têm scrim, gesto/fechamento, Escape, focus trap e devolução de foco.
- [x] Scrims não interceptam o arrasto do panorama.
- [x] Abaixo de 768 px, clusters/diálogos dão lugar à tab bar e aos sheets.
- [x] `prefers-reduced-motion` elimina as animações não essenciais.

## Validação manual ainda necessária

- [ ] Rodar o roteiro completo em um iPhone físico.
- [ ] Rodar o roteiro completo em um Android físico.

Essas duas verificações dependem de aparelhos reais e não foram simuladas no
ambiente local. Não há pendência conhecida nos testes automatizados.

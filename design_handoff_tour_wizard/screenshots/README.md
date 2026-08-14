# Screenshots

Capturas do protótipo `Novo Tour - Fluxo em 3 etapas.dc.html`. Todas em 2x.

## Desktop (largura de conteúdo 1120px)

| Arquivo | Tela |
|---|---|
| `01-etapa1-desktop.png` | Etapa 1 — dropzone com os dois botões (Enviar arquivos / Tirar foto agora), caixa de dica e lista de ambientes com badge "Capa" |
| `02-etapa2-hotspots-desktop.png` | Etapa 2 — viewer com pins em pílula, rail de ambientes e painel de hotspots à direita (título, tipo, destino) |
| `03-etapa3-informacoes-desktop.png` | Etapa 3 — formulário com acordeão de endereço aberto e card "Resumo do tour" |
| `04-sucesso-desktop.png` | Estado final "Tour publicado" |

## Mobile (402px)

| Arquivo | Tela |
|---|---|
| `05-etapa1-mobile.png` | Etapa 1 — botões empilhados em largura total, "Próximo" com `flex:1` |
| `06-etapa2-mobile.png` | Etapa 2 — viewer 4:3, rail, linha-resumo de hotspots (sem painel lateral) |
| `07-bottomsheet-editor-mobile.png` | Bottom sheet em modo *editor* — título, tipo (pílulas de 48px), destino, Excluir / Ir para |
| `08-bottomsheet-lista-mobile.png` | Bottom sheet em modo *lista* — todos os pontos do ambiente com metadados |
| `09-arrastar-lixeira-mobile.png` | Gesto de long-press + arraste: lixeira em estado "Solte para excluir" |
| `10-etapa3-mobile.png` | Etapa 3 empilhada, com endereço aberto |

## Notas de leitura

- O toggle **Desktop / Mobile** e o **quadro branco com sombra** visíveis nas capturas são
  artifícios da demo. No produto isso é responsividade e a página inteira. Ver README principal.
- As imagens 360° são placeholders em degradê gerados para a captura — no produto são as fotos
  reais enviadas pelo usuário.
- Em `02`, os campos "Destino" aparecem como "Selecione o ambiente…" por limitação do motor de
  captura (que não serializa a opção selecionada de um `<select>`). No protótipo em execução
  eles mostram corretamente "Cozinha" e "Suíte" — confirme abrindo o HTML.
- `09` foi capturado com o estado de arraste forçado, para documentar o alvo da lixeira; no uso
  real ele só aparece durante o gesto.

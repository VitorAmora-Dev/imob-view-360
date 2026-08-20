/**
 * Nome da intenção que a home passa à página do imóvel: "abri esta página já
 * querendo enviar a primeira imagem".
 *
 * **Quem transporta é o `NavigationIntentService`, não o router state.** Uma
 * versão anterior levava isto em `router.navigate(..., { state })`, com a
 * justificativa de que um refresh não reabriria o seletor de arquivo. Medido em
 * navegador de verdade, reabria — e em todo refresh seguinte. O motivo está
 * escrito no serviço.
 *
 * A constante mora aqui, e não no serviço, porque é o vocabulário compartilhado
 * entre os dois lados da navegação; o serviço é o mecanismo.
 */
export const ADD_TOUR_INTENT = 'add-tour';

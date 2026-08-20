/**
 * Intenção carregada no router state entre a home e a página do imóvel.
 *
 * Router state, e não query param, por duas razões: `onCardClick` já usa
 * `state: { property }`, então é o mesmo mecanismo; e um refresh não deve
 * reabrir o seletor de arquivo — com query param, reabriria.
 *
 * Mora em `models/` porque é consumida por um componente e por uma página;
 * exportá-la da página faria um componente depender de uma página, invertendo
 * a direção que o resto do código respeita.
 */
export const ADD_TOUR_INTENT = 'add-tour';

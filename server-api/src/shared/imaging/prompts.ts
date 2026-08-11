import { FaceName } from './cubemap';

/**
 * Os prompts do bake-off, separados porque são a peça que mais vai ser mexida.
 * Trocar uma frase aqui não deveria obrigar a reler o orquestrador.
 *
 * Estão em inglês de propósito: é o idioma em que os dois modelos foram mais
 * treinados para geração de imagem. O idioma é, ele próprio, uma variável a
 * testar — se o resultado em português vier igual, o prompt fica em português.
 *
 * Três regras aparecem em todos eles, e são a razão de o bake-off existir:
 *   1. preencher SÓ a região sem dado;
 *   2. não inventar mobília, objeto ou acabamento que as referências não mostrem
 *      — é anúncio de imóvel, não decoração;
 *   3. continuar a perspectiva da face, que é um recorte de 90° de uma esfera.
 */

const FIDELIDADE = [
  'This is a real-estate listing photo. Accuracy is legally required.',
  'Do NOT invent, add, remove or restyle any furniture, object, appliance or finish.',
  'Do NOT change anything outside the transparent region.',
  'Only continue surfaces that are already visible in the reference images.',
].join(' ');

/** Face do chão: é onde mora o maior buraco e o defeito mais visível do tour. */
function nadir(): string {
  return [
    'You are completing the DOWN face of a cube map taken from a 360° interior panorama.',
    'The camera looks straight down at the floor; the face covers a 90° field of view.',
    'The transparent region is directly below the camera and was never photographed.',
    '',
    'Fill it with a seamless continuation of the floor visible at the edges and in the reference images:',
    'same material, same colour, same grain, same tile size.',
    'Grout lines and floorboards must stay straight and converge correctly toward the centre of the face,',
    'meeting the existing lines at the boundary without any offset or change of angle.',
    'Keep the lighting flat and even, matching the brightness already present at the edges —',
    'there is no light source below the floor.',
    'A tripod, a shadow or a person must NOT appear.',
    '',
    FIDELIDADE,
  ].join('\n');
}

/** Face do teto: normalmente mais simples, mas onde luminária inventada denuncia na hora. */
function zenite(): string {
  return [
    'You are completing the UP face of a cube map taken from a 360° interior panorama.',
    'The camera looks straight up at the ceiling; the face covers a 90° field of view.',
    'The transparent region is directly above the camera and was never photographed.',
    '',
    'Fill it with a seamless continuation of the ceiling visible at the edges and in the reference images:',
    'same colour, same finish, same slab or panel direction.',
    'Beams, panel joints and mouldings must continue straight from the boundary without any offset.',
    'Do NOT add lamps, ceiling fans, air vents, skylights or fixtures of any kind',
    'unless the same fixture is already partially visible at the boundary and simply needs completing.',
    '',
    FIDELIDADE,
  ].join('\n');
}

export function promptDePolo(face: FaceName): string {
  return face === 'ny' ? nadir() : zenite();
}

/**
 * Experimento B: remendo pontual sobre uma quebra geométrica de costura.
 * A causa raiz é de captura, não de prompt — aqui só se mede quanto o inpaint
 * recupera do que sobrou depois do stitcher.
 */
export function promptDeRemendo(): string {
  return [
    'You are repairing a small stitching artifact in a photo of a room interior.',
    'The transparent region sits on a seam where two photographs were joined,',
    'and straight edges (wall corners, ceiling lines, door frames, skirting boards)',
    'break or jump across it.',
    '',
    'Reconnect those lines so they run straight and continuous through the region.',
    'Match the surrounding texture, colour and lighting exactly.',
    'The repair must be invisible: no blur, no smear, no repeated pattern.',
    '',
    FIDELIDADE,
  ].join('\n');
}

/**
 * Experimento C, rota generativa. O critério declarado é o mesmo que o corretor
 * teria de sustentar na frente do comprador: a foto pode estar melhor tratada,
 * mas tem de ser o mesmo imóvel.
 */
export function promptDeIluminacao(): string {
  return [
    'Improve the lighting of this real-estate interior photo so it looks professionally shot.',
    '',
    'Allowed: lift shadows so dark corners read clearly, recover detail in blown-out windows,',
    'neutralise colour casts from mixed daylight and lamp light, even out exposure across the frame.',
    '',
    'Forbidden: moving, adding, removing or restyling anything;',
    'changing wall colour, flooring, furniture or finishes;',
    'inventing light fixtures or window views;',
    'any change that would make a buyer say the room looked different in person.',
    '',
    'The room must stay recognisably the same room. Keep it photographic, not rendered.',
  ].join('\n');
}

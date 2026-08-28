import { toCreateTourPayload } from './publish-payload';
import { WizardScene } from './tour-wizard.model';

/**
 * O tour visto como grafo: quem o visitante alcança, e de onde ele não sai.
 *
 * DONO: Frente B.
 *
 * Existe por um fato da tela do visitante, e não por preferência de UX: o
 * `embed` é `<app-panoramic-viewer>` e mais nada, e o template do viewer é um
 * canvas e um spinner. Não há lista de ambientes, menu, seta — **o único jeito
 * de trocar de ambiente é clicar num hotspot**.
 *
 * Logo, publicar cinco ambientes sem ligação nenhuma entrega um tour em que o
 * visitante vê UM ambiente. Os outros quatro foram fotografados, costurados,
 * enviados e guardados, e são inalcançáveis. O wizard é o único lugar que pode
 * pegar isso antes de virar link mandado para cliente.
 *
 * Função pura, como a projeção: a regra é aritmética de grafo e testá-la não
 * deve exigir store nem componente.
 */

/**
 * As saídas de cada ambiente, **lidas do payload de publicação**.
 *
 * Isto não é preciosismo. Quem decide se um hotspot vira aresta é o
 * `toCreateTourPayload`, que descarta ponto sem destino e ponto apontando para
 * cena removida. Reescrever essa regra aqui criaria duas versões da mesma
 * verdade — e a que o wizard usasse para dizer "está tudo ligado" poderia
 * discordar da que o servidor recebe, entregando exatamente o ambiente órfão
 * que este arquivo existe para impedir.
 *
 * Este sprint já pagou uma vez por duplicar regra em vez de chamar a função
 * (o eixo espelhado do `addHotspots`). Uma vez basta.
 */
function saidasPublicadas(scenes: WizardScene[]): Map<string, string[]> {
  const { panoramas } = toCreateTourPayload(scenes);
  const saidas = new Map<string, string[]>();

  // `PanoramaUpload` traz `tempId` e `hotspots` opcionais porque o mesmo tipo
  // serve ao fluxo antigo, que sobe panorama avulso. Aqui os dois sempre vêm —
  // o `toCreateTourPayload` os preenche —, mas quem lê isto daqui a um ano não
  // sabe disso pela assinatura.
  for (const panorama of panoramas) {
    if (!panorama.tempId) continue;
    const destinos: string[] = [];
    for (const hotspot of panorama.hotspots ?? []) {
      if (hotspot.targetTempId) destinos.push(hotspot.targetTempId);
    }
    saidas.set(panorama.tempId, destinos);
  }

  return saidas;
}

/** De onde as arestas do grafo vêm. Ver `saidasEscolhidas`. */
export type FonteDeSaidas = (scenes: WizardScene[]) => Map<string, string[]>;

/**
 * Arestas lidas das CONEXÕES ESCOLHIDAS, e não dos hotspots posicionados.
 *
 * Existe para a tela de ordenação poder avisar cedo. A leitura padrão
 * (`saidasPublicadas`) só enxerga hotspot já posicionado — correto para o
 * bloqueio final, inútil numa tela onde ainda não há nenhum.
 *
 * As duas podem discordar num intervalo: conexão escolhida e ainda não
 * posicionada. É deliberado — o aviso da ordenação fala do que VAI ser
 * montado, e o do `canAdvance` fala do que está montado.
 *
 * Conexão para ambiente que não existe mais não vira aresta: ela seria um
 * caminho para lugar nenhum.
 */
export function saidasEscolhidas(scenes: WizardScene[]): Map<string, string[]> {
  const cenas = prontas(scenes);
  const existe = new Set(cenas.map((s) => s.id));
  const saidas = new Map<string, string[]>();

  for (const cena of cenas) {
    saidas.set(
      cena.id,
      (cena.connections ?? []).filter((id) => existe.has(id)),
    );
  }
  return saidas;
}

/** Cenas com imagem, na ordem em que o payload as numera. */
function prontas(scenes: WizardScene[]): WizardScene[] {
  return scenes.filter((s) => s.state === 'ready');
}

/**
 * Ambientes que o visitante não tem como alcançar.
 *
 * Busca em largura a partir do ambiente inicial, que é `readyScenes()[0]` —
 * mesma cena que o payload marca com `initialPanorama: i === 0`.
 *
 * Com menos de dois ambientes devolve vazio: não há para onde ir, e a etapa de
 * pontos deixa de fazer sentido.
 */
export function ambientesIlhados(
  scenes: WizardScene[],
  fonte: FonteDeSaidas = saidasPublicadas,
): WizardScene[] {
  const cenas = prontas(scenes);
  if (cenas.length < 2) return [];

  const saidas = fonte(scenes);
  const inicio = cenas[0].id;
  const vistos = new Set<string>([inicio]);
  const fila: string[] = [inicio];

  while (fila.length) {
    const atual = fila.shift()!;
    for (const destino of saidas.get(atual) ?? []) {
      if (vistos.has(destino)) continue;
      vistos.add(destino);
      fila.push(destino);
    }
  }

  return cenas.filter((s) => !vistos.has(s.id));
}

/**
 * Ambientes em que se entra e dos quais não se sai.
 *
 * Alcançar não é o mesmo que poder voltar: um ponto da sala para a cozinha, sem
 * ponto de volta, deixa o visitante preso na cozinha — e a única saída dele é
 * recarregar a página, que o joga na sala de novo e apaga o passeio.
 *
 * Isto AVISA, não bloqueia. Exigir volta de todo ambiente é uma regra mais dura
 * do que o defeito justifica: existe desenho legítimo em que um corredor é o
 * centro e os cômodos penduram nele, e ali a volta é óbvia para quem monta.
 *
 * E fica calado enquanto houver ambiente ilhado. As mesmas ligações que faltam
 * produzem os dois sintomas: um tour sem ligação nenhuma tem todo mundo
 * inalcançável E o ambiente inicial sem saída. Mostrar as duas listas ao mesmo
 * tempo faria a tela apontar dois problemas onde há um, e disputar a atenção de
 * quem já está tentando consertar. Beco sem saída só é informação NOVA depois
 * que tudo se alcança.
 */
export function becosSemSaida(
  scenes: WizardScene[],
  fonte: FonteDeSaidas = saidasPublicadas,
): WizardScene[] {
  const cenas = prontas(scenes);
  if (cenas.length < 2) return [];
  if (ambientesIlhados(scenes, fonte).length) return [];

  const saidas = fonte(scenes);
  return cenas.filter((s) => (saidas.get(s.id) ?? []).length === 0);
}

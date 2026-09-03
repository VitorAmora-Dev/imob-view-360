import { Injectable, NotFoundException } from '@nestjs/common';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { SELECAO_PARA_EDICAO, formatarParaEdicao } from './tour-para-edicao';

/**
 * O tour inteiro para quem vai voltar a editá-lo.
 *
 * Existe separado do `FindVirtualTourService` pela mesma razão que o
 * `/panoramas/:id/preview` existe separado do `/image`: aquela rota é pública,
 * e por isso filtra `PUBLISHED` — sem o filtro, qualquer um com um uuid leria
 * o rascunho de qualquer imobiliária. Aqui a autorização vem do token e do
 * escopo por agência.
 *
 * Mas o status IMPORTA, e no sentido oposto: aqui só passa `DRAFT`.
 *
 * Esta rota alimenta o wizard, e o wizard trata o que recebe como rascunho —
 * a tela de sair oferece "Descartar captura", que apaga o `Property` em
 * cascata. Servir um tour PUBLICADO por aqui punha esse botão em cima de um
 * tour no ar: o corretor perderia panoramas, hotspots, o tratamento de IA já
 * pago e o link que ele mesmo mandou para o cliente.
 *
 * O caminho existia: a faixa da home busca no `ngOnInit` e o `ion-router-outlet`
 * mantém a página em cache, então um cartão continuava clicável depois de
 * publicado. A trava fica AQUI, e não na faixa, porque uma URL guardada, um
 * favorito ou dois aparelhos em corrida chegam ao mesmo lugar sem passar por
 * ela.
 *
 * Nenhuma coluna de imagem, pelo mesmo motivo daquela consulta: elas são TOAST
 * de dezenas de MB e o wizard só precisa da foto do cômodo que está à vista.
 *
 * VER TAMBÉM `FindEditableTourService`, que serve o MESMO shape para tour
 * publicado (`GET /virtual-tours/:id/edicao`, SPRINT-4-TOUR-VIEWER.md, TV-10).
 * A trava daqui continua valendo, e é por isso que aquele existe: enquanto
 * forem duas rotas, "isto é descartável" é uma afirmação do servidor, e não uma
 * convenção que o cliente precisa lembrar de respeitar. Quem afrouxar o
 * `status: 'DRAFT'` abaixo devolve o botão de descarte para cima de um tour no
 * ar e torna a outra rota inútil no mesmo commit.
 */
@Injectable()
export class FindDraftTourService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(id: string, currentUser: JwtPayload) {
    const tour = await this.prisma.virtualTour.findFirst({
      where: {
        id,
        status: 'DRAFT',
        property: { agencyId: currentUser.agencyId },
      },
      select: SELECAO_PARA_EDICAO,
    });
    // 404 e não 403: 403 confirmaria que o id existe em outra imobiliária. E
    // 404 também para tour publicado — do ponto de vista de quem pede um
    // rascunho, ele deixou de existir quando virou tour.
    if (!tour) throw new NotFoundException('Draft tour not found');

    return formatarParaEdicao(tour);
  }
}

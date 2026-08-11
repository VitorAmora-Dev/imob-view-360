import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAccessGuard } from '../../../common/guards/jwt-access.guard';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { MontarTourService } from '../services/montar-tour.service';

@ApiTags('Virtual Tours')
@Controller('virtual-tours')
export class MontarTourController {
  constructor(private readonly service: MontarTourService) {}

  @Post(':id/montar')
  @HttpCode(202)
  @UseGuards(JwtAccessGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Enfileira a montagem por IA dos panoramas do tour',
    description:
      'Só deve ser chamado depois de as fotos originais da captura terem subido: ' +
      'sem elas o modelo não tem referência e o panorama é dispensado. ' +
      'Responde na hora; acompanhe por GET /virtual-tours/:id/montagem.',
  })
  montar(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.iniciar(id, user);
  }

  @Get(':id/montagem')
  @UseGuards(JwtAccessGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Andamento da montagem por IA' })
  andamento(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.andamento(id, user);
  }
}

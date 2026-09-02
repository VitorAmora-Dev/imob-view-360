import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAccessGuard } from '../../../common/guards/jwt-access.guard';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { FindEditableTourService } from '../services/find-editable-tour.service';

@ApiTags('Virtual Tours')
@Controller('virtual-tours')
export class FindEditableTourController {
  constructor(private readonly service: FindEditableTourService) {}

  @Get(':id/edicao')
  @UseGuards(JwtAccessGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Tour completo para reabrir no wizard, publicado inclusive',
    description:
      'Mesmo shape de `:id/rascunho`, e a diferença é só o status que passa. ' +
      'Aquela rota serve apenas DRAFT, porque o wizard aberto por ela oferece ' +
      'descartar a captura — o que apagaria um tour no ar. Esta serve DRAFT e ' +
      'PUBLISHED, e o cliente que a usa entra em modo de edição, sem descarte.',
  })
  findEditable(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.execute(id, user);
  }
}

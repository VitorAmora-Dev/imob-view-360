import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAccessGuard } from '../../../common/guards/jwt-access.guard';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { ListDraftToursSchema } from '../dto/list-draft-tours.dto';
import { ListDraftToursService } from '../services/list-draft-tours.service';

@ApiTags('Virtual Tours')
@Controller('virtual-tours')
export class ListDraftToursController {
  constructor(private readonly service: ListDraftToursService) {}

  // `@Get()` sem parâmetro DE PROPÓSITO. `GET /virtual-tours/rascunhos` seria
  // capturado pelo `@Get(':id')` do FindVirtualTourController dependendo da
  // ordem de registro dos controllers — uma armadilha que não quebra na
  // compilação e só aparece em runtime, como 404 de tour inexistente.
  @Get()
  @UseGuards(JwtAccessGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Capturas em andamento da imobiliária' })
  @ApiQuery({ name: 'status', required: true, description: 'DRAFT' })
  list(
    @Query(new ZodValidationPipe(ListDraftToursSchema)) _query: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.execute(user);
  }
}

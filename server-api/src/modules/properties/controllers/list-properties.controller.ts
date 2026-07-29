import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAccessGuard } from '../../../common/guards/jwt-access.guard';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { ListPropertiesSchema, ListPropertiesDto } from '../dto/list-properties.dto';
import { ListPropertiesService } from '../services/list-properties.service';

@ApiTags('Properties')
@Controller('properties')
export class ListPropertiesController {
  constructor(private readonly listPropertiesService: ListPropertiesService) {}

  @Get()
  @UseGuards(JwtAccessGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Lista imóveis da imobiliária com filtros' })
  @ApiOkResponse({ description: 'Lista paginada de imóveis' })
  findAll(
    @Query(new ZodValidationPipe(ListPropertiesSchema)) query: ListPropertiesDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.listPropertiesService.execute(query, user);
  }
}

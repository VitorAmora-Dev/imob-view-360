import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAccessGuard } from '../../../common/guards/jwt-access.guard';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { FindPropertyService } from '../services/find-property.service';

@ApiTags('Properties')
@Controller('properties')
export class FindPropertyController {
  constructor(private readonly findPropertyService: FindPropertyService) {}

  @Get(':id')
  @UseGuards(JwtAccessGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Busca um imóvel pelo ID' })
  @ApiOkResponse({ description: 'Detalhes do imóvel' })
  @ApiNotFoundResponse({ description: 'Imóvel não encontrado' })
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.findPropertyService.execute(id, user);
  }
}

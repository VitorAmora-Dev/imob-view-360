import { Controller, Delete, HttpCode, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '../../../common/guards/jwt-access.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { DeletePropertyService } from '../services/delete-property.service';

@ApiTags('Properties')
@Controller('properties')
export class DeletePropertyController {
  constructor(private readonly service: DeletePropertyService) {}

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(JwtAccessGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Remove um imóvel e todos os seus dados' })
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.execute(id, user);
  }
}

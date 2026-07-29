import { Controller, Delete, HttpCode, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '../../../common/guards/jwt-access.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { DeleteVirtualTourService } from '../services/delete-virtual-tour.service';

@ApiTags('Virtual Tours')
@Controller('virtual-tours')
export class DeleteVirtualTourController {
  constructor(private readonly service: DeleteVirtualTourService) {}

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(JwtAccessGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Remove um tour virtual e todos os seus panoramas' })
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.execute(id, user);
  }
}

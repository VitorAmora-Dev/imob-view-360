import { Controller, Delete, HttpCode, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '../../../common/guards/jwt-access.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { DeletePanoramaService } from '../services/delete-panorama.service';

@ApiTags('Panoramas')
@Controller('panoramas')
export class DeletePanoramaController {
  constructor(private readonly service: DeletePanoramaService) {}

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(JwtAccessGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Remove um panorama' })
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.execute(id, user);
  }
}

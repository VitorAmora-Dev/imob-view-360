import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAccessGuard } from '../../../common/guards/jwt-access.guard';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import {
  UpdatePanoramaDto,
  UpdatePanoramaSchema,
} from '../dto/update-panorama.dto';
import { UpdatePanoramaService } from '../services/update-panorama.service';

@ApiTags('Panoramas')
@Controller('panoramas')
export class UpdatePanoramaController {
  constructor(private readonly service: UpdatePanoramaService) {}

  @Patch(':id')
  @UseGuards(JwtAccessGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Atualiza um panorama' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdatePanoramaSchema)) dto: UpdatePanoramaDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.execute(id, dto, user);
  }
}

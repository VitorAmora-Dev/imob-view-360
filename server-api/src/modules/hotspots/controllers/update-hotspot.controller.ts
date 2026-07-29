import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAccessGuard } from '../../../common/guards/jwt-access.guard';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import {
  UpdateHotspotDto,
  UpdateHotspotSchema,
} from '../dto/update-hotspot.dto';
import { UpdateHotspotService } from '../services/update-hotspot.service';

@ApiTags('Hotspots')
@Controller('hotspots')
export class UpdateHotspotController {
  constructor(private readonly service: UpdateHotspotService) {}

  @Patch(':id')
  @UseGuards(JwtAccessGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Atualiza um hotspot' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateHotspotSchema)) dto: UpdateHotspotDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.execute(id, dto, user);
  }
}

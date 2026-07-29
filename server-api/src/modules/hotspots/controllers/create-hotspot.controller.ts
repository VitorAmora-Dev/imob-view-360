import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAccessGuard } from '../../../common/guards/jwt-access.guard';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import {
  CreateHotspotDto,
  CreateHotspotSchema,
} from '../dto/create-hotspot.dto';
import { CreateHotspotService } from '../services/create-hotspot.service';

@ApiTags('Hotspots')
@Controller('hotspots')
export class CreateHotspotController {
  constructor(private readonly service: CreateHotspotService) {}

  @Post()
  @UseGuards(JwtAccessGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Adiciona hotspot ao panorama' })
  create(
    @Body(new ZodValidationPipe(CreateHotspotSchema)) dto: CreateHotspotDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.execute(dto, user);
  }
}

import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAccessGuard } from '../../../common/guards/jwt-access.guard';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import {
  CreatePanoramaDto,
  CreatePanoramaSchema,
} from '../dto/create-panorama.dto';
import { CreatePanoramaService } from '../services/create-panorama.service';

@ApiTags('Panoramas')
@Controller('panoramas')
export class CreatePanoramaController {
  constructor(private readonly service: CreatePanoramaService) {}

  @Post()
  @UseGuards(JwtAccessGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Adiciona panorama ao tour (com medidas)' })
  create(
    @Body(new ZodValidationPipe(CreatePanoramaSchema)) dto: CreatePanoramaDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.execute(dto, user);
  }
}

import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAccessGuard } from '../../../common/guards/jwt-access.guard';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { UpdateVirtualTourDto, UpdateVirtualTourSchema } from '../dto/update-virtual-tour.dto';
import { UpdateVirtualTourService } from '../services/update-virtual-tour.service';

@ApiTags('Virtual Tours')
@Controller('virtual-tours')
export class UpdateVirtualTourController {
  constructor(private readonly service: UpdateVirtualTourService) {}

  @Patch(':id')
  @UseGuards(JwtAccessGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Atualiza o status do tour (DRAFT | PUBLISHED | ARCHIVED)' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateVirtualTourSchema)) dto: UpdateVirtualTourDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.execute(id, dto, user);
  }
}

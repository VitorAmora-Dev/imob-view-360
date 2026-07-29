import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAccessGuard } from '../../../common/guards/jwt-access.guard';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import {
  CreateVirtualTourDto,
  CreateVirtualTourSchema,
} from '../dto/create-virtual-tour.dto';
import { CreateVirtualTourService } from '../services/create-virtual-tour.service';

@ApiTags('Virtual Tours')
@Controller('virtual-tours')
export class CreateVirtualTourController {
  constructor(private readonly service: CreateVirtualTourService) {}

  @Post()
  @UseGuards(JwtAccessGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Cria um tour virtual para um imóvel' })
  create(
    @Body(new ZodValidationPipe(CreateVirtualTourSchema))
    dto: CreateVirtualTourDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.execute(dto, user);
  }
}

import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAccessGuard } from '../../../common/guards/jwt-access.guard';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import {
  CreatePropertyDto,
  CreatePropertySchema,
} from '../dto/create-property.dto';
import { CreatePropertyService } from '../services/create-property.service';

@ApiTags('Properties')
@Controller('properties')
export class CreatePropertyController {
  constructor(private readonly createPropertyService: CreatePropertyService) {}

  @Post()
  @UseGuards(JwtAccessGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Cria um novo imóvel' })
  @ApiCreatedResponse({ description: 'Imóvel criado' })
  create(
    @Body(new ZodValidationPipe(CreatePropertySchema)) dto: CreatePropertyDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.createPropertyService.execute(dto, user);
  }
}

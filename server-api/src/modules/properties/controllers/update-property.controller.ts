import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAccessGuard } from '../../../common/guards/jwt-access.guard';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import {
  UpdatePropertyDto,
  UpdatePropertySchema,
} from '../dto/update-property.dto';
import { UpdatePropertyService } from '../services/update-property.service';

@ApiTags('Properties')
@Controller('properties')
export class UpdatePropertyController {
  constructor(private readonly updatePropertyService: UpdatePropertyService) {}

  @Patch(':id')
  @UseGuards(JwtAccessGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Atualiza os dados de um imóvel' })
  @ApiOkResponse({ description: 'Imóvel atualizado' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdatePropertySchema)) dto: UpdatePropertyDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.updatePropertyService.execute(id, dto, user);
  }
}

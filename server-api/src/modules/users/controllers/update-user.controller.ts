import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { JwtAccessGuard } from '../../../common/guards/jwt-access.guard';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { UpdateUserDto, UpdateUserSchema } from '../dto/update-user.dto';
import { UpdateUserService } from '../services/update-user.service';

@ApiTags('Users')
@Controller('users')
export class UpdateUserController {
  constructor(private readonly updateUserService: UpdateUserService) {}

  @Patch(':id')
  @UseGuards(JwtAccessGuard, AdminGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Atualiza dados de um usuário' })
  @ApiOkResponse({ description: 'Usuário atualizado' })
  @ApiNotFoundResponse({ description: 'Usuário não encontrado' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateUserSchema)) dto: UpdateUserDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.updateUserService.execute(id, dto, user);
  }
}

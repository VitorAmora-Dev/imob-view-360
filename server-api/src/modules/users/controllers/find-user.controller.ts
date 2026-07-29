import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiOkResponse, ApiNotFoundResponse } from '@nestjs/swagger';
import { JwtAccessGuard } from '../../../common/guards/jwt-access.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { FindUserService } from '../services/find-user.service';

@ApiTags('Users')
@Controller('users')
export class FindUserController {
  constructor(private readonly findUserService: FindUserService) {}

  @Get(':id')
  @UseGuards(JwtAccessGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Busca um usuário pelo ID' })
  @ApiOkResponse({ description: 'Dados do usuário' })
  @ApiNotFoundResponse({ description: 'Usuário não encontrado' })
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.findUserService.execute(id, user);
  }
}

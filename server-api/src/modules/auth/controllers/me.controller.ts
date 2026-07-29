import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiUnauthorizedResponse, ApiOkResponse } from '@nestjs/swagger';
import { JwtAccessGuard } from '../../../common/guards/jwt-access.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';

@ApiTags('Auth')
@Controller('auth')
export class MeController {
  @Get('me')
  @UseGuards(JwtAccessGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Retorna o payload do usuário logado' })
  @ApiOkResponse({ description: 'Payload do JWT' })
  @ApiUnauthorizedResponse({ description: 'Token inválido ou ausente' })
  me(@CurrentUser() user: JwtPayload) {
    return user;
  }
}

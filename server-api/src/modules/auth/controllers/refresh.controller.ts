import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiUnauthorizedResponse, ApiOkResponse, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { REFRESH_THROTTLE } from '../../../config/throttle.config';
import { RefreshService } from '../services/refresh.service';
import { JwtRefreshGuard } from '../../../common/guards/jwt-refresh.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RefreshContext } from '../../../common/strategies/jwt-refresh.strategy';

@ApiTags('Auth')
@Controller('auth')
export class RefreshController {
  constructor(private readonly refreshService: RefreshService) {}

  @Post('refresh')
  @HttpCode(200)
  @UseGuards(JwtRefreshGuard)
  @Throttle(REFRESH_THROTTLE)
  @ApiBearerAuth('refresh-token')
  @ApiOperation({ summary: 'Renova access token e refresh token' })
  @ApiOkResponse({ description: 'Tokens renovados' })
  @ApiUnauthorizedResponse({ description: 'Refresh token inválido ou expirado' })
  @ApiTooManyRequestsResponse({ description: 'Muitas renovações em sequência' })
  refresh(@CurrentUser() context: RefreshContext) {
    return this.refreshService.execute(context);
  }
}

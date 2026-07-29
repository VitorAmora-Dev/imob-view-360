import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { JwtAccessGuard } from '../../../common/guards/jwt-access.guard';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { GetAnalyticsService } from '../services/get-analytics.service';

@ApiTags('Virtual Tours')
@Controller('virtual-tours')
export class GetAnalyticsController {
  constructor(private readonly service: GetAnalyticsService) {}

  @Get(':id/analytics')
  @UseGuards(JwtAccessGuard, AdminGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Analytics do tour (views, shares, tempo médio)' })
  analytics(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.execute(id, user);
  }
}

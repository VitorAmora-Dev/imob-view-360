import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags, ApiUnauthorizedResponse, ApiOkResponse, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SigninService } from '../services/signin.service';
import { SigninSchema, SigninDto } from '../dto/signin.dto';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { SIGNIN_THROTTLE } from '../../../config/throttle.config';

@ApiTags('Auth')
@Controller('auth')
export class SigninController {
  constructor(private readonly signinService: SigninService) {}

  @Post('signin')
  @HttpCode(200)
  @Throttle(SIGNIN_THROTTLE)
  @ApiOperation({ summary: 'Autentica usuário e retorna tokens' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email', 'password'],
      properties: {
        email: { type: 'string', format: 'email', example: 'joao@central.com' },
        password: { type: 'string', example: 'senha123' },
      },
    },
  })
  @ApiOkResponse({ description: 'Autenticado com sucesso' })
  @ApiUnauthorizedResponse({ description: 'Credenciais inválidas' })
  @ApiTooManyRequestsResponse({ description: 'Muitas tentativas de login' })
  signin(@Body(new ZodValidationPipe(SigninSchema)) dto: SigninDto) {
    return this.signinService.execute(dto);
  }
}

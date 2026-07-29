import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags, ApiUnauthorizedResponse, ApiOkResponse } from '@nestjs/swagger';
import { SigninService } from '../services/signin.service';
import { SigninSchema, SigninDto } from '../dto/signin.dto';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';

@ApiTags('Auth')
@Controller('auth')
export class SigninController {
  constructor(private readonly signinService: SigninService) {}

  @Post('signin')
  @HttpCode(200)
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
  signin(@Body(new ZodValidationPipe(SigninSchema)) dto: SigninDto) {
    return this.signinService.execute(dto);
  }
}

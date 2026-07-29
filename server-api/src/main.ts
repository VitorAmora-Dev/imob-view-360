import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import {
  bodyLimitMiddleware,
  urlencodedMiddleware,
} from './config/body-limit.config';

async function bootstrap() {
  // bodyParser: false para que os parsers abaixo rodem antes do roteador do Nest
  // e o limite alto valha só nas rotas de imagem — ver body-limit.config.ts
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  app.use(bodyLimitMiddleware());
  app.use(urlencodedMiddleware());

  const config = new DocumentBuilder()
    .setTitle('Inner View API')
    .setDescription('API do sistema de tours virtuais imobiliários')
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'refresh-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();

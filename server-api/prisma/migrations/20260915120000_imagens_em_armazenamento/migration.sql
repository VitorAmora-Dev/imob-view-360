-- Passo 1 da migração das fotos para armazenamento de objetos.
-- Sozinha, sem mudança de comportamento: as colunas nascem vazias e a leitura
-- ainda não as consulta.
ALTER TABLE "Panorama" ADD COLUMN "imageKey" TEXT;
ALTER TABLE "Panorama" ADD COLUMN "treatedImageKey" TEXT;
ALTER TABLE "CaptureFrame" ADD COLUMN "imageKey" TEXT;

-- As colunas de bytes passam a aceitar nulo. Nenhuma linha existente muda.
ALTER TABLE "Panorama" ALTER COLUMN "imageData" DROP NOT NULL;
ALTER TABLE "CaptureFrame" ALTER COLUMN "imageData" DROP NOT NULL;

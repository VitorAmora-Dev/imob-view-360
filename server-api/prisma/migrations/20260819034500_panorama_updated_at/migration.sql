-- AlterTable
-- `DEFAULT CURRENT_TIMESTAMP` cobre as linhas que já existem. A expressão é
-- STABLE, então o Postgres usa o caminho rápido de ADD COLUMN e não reescreve a
-- tabela — o que importa aqui, porque `Panorama` tem centenas de MB em TOAST.
ALTER TABLE "Panorama" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
-- `DEFAULT ARRAY[]::TEXT[]` cobre as linhas que já existem, e a expressão é
-- constante — o Postgres usa o caminho rápido de ADD COLUMN e não reescreve a
-- tabela, o que importa aqui porque `Panorama` tem centenas de MB em TOAST.
ALTER TABLE "Panorama" ADD COLUMN     "draftConnections" TEXT[] DEFAULT ARRAY[]::TEXT[];

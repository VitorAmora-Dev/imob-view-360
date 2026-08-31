-- AlterTable
-- `DEFAULT ARRAY[]::TEXT[]` cobre as linhas que já existem: imóvel de cadastro
-- normal nunca teve marcador, e vazio é a resposta certa para ele.
--
-- Rascunho antigo também chega vazio, e para ele a retomada mantém o critério
-- anterior (título ainda é o marcador ⇒ os três são) — ver `retomarRascunho`.
ALTER TABLE "Property" ADD COLUMN     "draftPlaceholders" TEXT[] DEFAULT ARRAY[]::TEXT[];

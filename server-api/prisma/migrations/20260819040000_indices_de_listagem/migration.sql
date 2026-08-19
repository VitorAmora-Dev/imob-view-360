-- Índices para as consultas que já existem hoje.
--
-- Em cada par, o composto substitui o simples: um índice `(a, b)` atende tudo o
-- que `(a)` atendia, porque o Postgres usa qualquer prefixo. Manter os dois
-- custaria escrita em dobro pela mesma leitura.
--
-- Ordem das operações: cria primeiro, derruba depois. Se o processo morrer no
-- meio, o pior caso é índice sobrando — nunca consulta sem índice.

-- Property: `GET /properties` filtra por agência e ordena por createdAt desc.
CREATE INDEX "Property_agencyId_createdAt_idx" ON "Property"("agencyId", "createdAt");
DROP INDEX "Property_agencyId_idx";

-- User: `GET /users` filtra por agência e ordena por nome.
CREATE INDEX "User_agencyId_name_idx" ON "User"("agencyId", "name");
DROP INDEX "User_agencyId_idx";

-- Panorama: toda leitura é "os deste tour, na ordem".
CREATE INDEX "Panorama_virtualTourId_order_idx" ON "Panorama"("virtualTourId", "order");
DROP INDEX "Panorama_virtualTourId_idx";

-- Panorama: o worker de IA varre por situação a cada boot, e o CLI `--pendentes`
-- faz o mesmo. Sem isto, os dois eram varredura completa de uma tabela com
-- 196 MB em TOAST.
CREATE INDEX "Panorama_treatmentStatus_idx" ON "Panorama"("treatmentStatus");

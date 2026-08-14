-- CreateEnum
CREATE TYPE "TreatmentStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "Panorama" ADD COLUMN     "treatedAt" TIMESTAMP(3),
ADD COLUMN     "treatedImageData" TEXT,
ADD COLUMN     "treatmentError" TEXT,
ADD COLUMN     "treatmentMeta" JSONB,
ADD COLUMN     "treatmentStatus" "TreatmentStatus" NOT NULL DEFAULT 'PENDING';

/*
  Warnings:

  - You are about to drop the column `imageFile` on the `Panorama` table. All the data in the column will be lost.
  - The `status` column on the `VirtualTour` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `imageData` to the `Panorama` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "VirtualTourStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Panorama" DROP COLUMN "imageFile",
ADD COLUMN     "imageData" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "VirtualTour" DROP COLUMN "status",
ADD COLUMN     "status" "VirtualTourStatus" NOT NULL DEFAULT 'DRAFT';

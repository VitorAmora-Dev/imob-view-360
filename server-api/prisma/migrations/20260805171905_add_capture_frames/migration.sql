-- CreateTable
CREATE TABLE "CaptureFrame" (
    "id" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "imageData" TEXT NOT NULL,
    "qx" DOUBLE PRECISION NOT NULL,
    "qy" DOUBLE PRECISION NOT NULL,
    "qz" DOUBLE PRECISION NOT NULL,
    "qw" DOUBLE PRECISION NOT NULL,
    "panoramaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaptureFrame_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaptureFrame_panoramaId_idx" ON "CaptureFrame"("panoramaId");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureFrame_panoramaId_index_key" ON "CaptureFrame"("panoramaId", "index");

-- AddForeignKey
ALTER TABLE "CaptureFrame" ADD CONSTRAINT "CaptureFrame_panoramaId_fkey" FOREIGN KEY ("panoramaId") REFERENCES "Panorama"("id") ON DELETE CASCADE ON UPDATE CASCADE;

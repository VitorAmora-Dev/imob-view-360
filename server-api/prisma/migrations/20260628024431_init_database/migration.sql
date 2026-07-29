-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('ADMINISTRATOR', 'AGENT');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('HOUSE', 'APARTMENT', 'LAND', 'COMMERCIAL', 'RURAL', 'OFFICE');

-- CreateEnum
CREATE TYPE "PropertyPurpose" AS ENUM ('SALE', 'RENT', 'SALE_OR_RENT');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('AVAILABLE', 'SOLD', 'RENTED', 'UNAVAILABLE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "type" "UserType" NOT NULL,
    "hashedRefreshToken" TEXT,
    "licenseNumber" TEXT,
    "agencyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agency" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "PropertyType" NOT NULL,
    "purpose" "PropertyPurpose" NOT NULL,
    "price" DOUBLE PRECISION,
    "totalArea" DOUBLE PRECISION,
    "status" "PropertyStatus" NOT NULL DEFAULT 'AVAILABLE',
    "agencyId" TEXT NOT NULL,
    "agentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Address" (
    "id" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "number" TEXT,
    "complement" TEXT,
    "district" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zipCode" TEXT,
    "propertyId" TEXT NOT NULL,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VirtualTour" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VirtualTour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Panorama" (
    "id" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "imageFile" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "initialPanorama" BOOLEAN NOT NULL DEFAULT false,
    "virtualTourId" TEXT NOT NULL,

    CONSTRAINT "Panorama_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hotspot" (
    "id" TEXT NOT NULL,
    "label" TEXT,
    "positionX" DOUBLE PRECISION NOT NULL,
    "positionY" DOUBLE PRECISION NOT NULL,
    "originId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,

    CONSTRAINT "Hotspot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Measurement" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'm',
    "panoramaId" TEXT NOT NULL,

    CONSTRAINT "Measurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visitor" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Visitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Share" (
    "id" TEXT NOT NULL,
    "sharedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" TEXT NOT NULL,
    "virtualTourId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,

    CONSTRAINT "Share_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "View" (
    "id" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationSeconds" INTEGER,
    "device" TEXT,
    "virtualTourId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,

    CONSTRAINT "View_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_agencyId_idx" ON "User"("agencyId");

-- CreateIndex
CREATE UNIQUE INDEX "Agency_taxId_key" ON "Agency"("taxId");

-- CreateIndex
CREATE UNIQUE INDEX "Property_code_key" ON "Property"("code");

-- CreateIndex
CREATE INDEX "Property_agencyId_idx" ON "Property"("agencyId");

-- CreateIndex
CREATE INDEX "Property_agentId_idx" ON "Property"("agentId");

-- CreateIndex
CREATE INDEX "Property_type_purpose_status_idx" ON "Property"("type", "purpose", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Address_propertyId_key" ON "Address"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "VirtualTour_propertyId_key" ON "VirtualTour"("propertyId");

-- CreateIndex
CREATE INDEX "Panorama_virtualTourId_idx" ON "Panorama"("virtualTourId");

-- CreateIndex
CREATE INDEX "Hotspot_originId_idx" ON "Hotspot"("originId");

-- CreateIndex
CREATE INDEX "Hotspot_targetId_idx" ON "Hotspot"("targetId");

-- CreateIndex
CREATE INDEX "Measurement_panoramaId_idx" ON "Measurement"("panoramaId");

-- CreateIndex
CREATE UNIQUE INDEX "Visitor_sessionId_key" ON "Visitor"("sessionId");

-- CreateIndex
CREATE INDEX "Share_virtualTourId_idx" ON "Share"("virtualTourId");

-- CreateIndex
CREATE INDEX "Share_visitorId_idx" ON "Share"("visitorId");

-- CreateIndex
CREATE INDEX "View_virtualTourId_idx" ON "View"("virtualTourId");

-- CreateIndex
CREATE INDEX "View_visitorId_idx" ON "View"("visitorId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualTour" ADD CONSTRAINT "VirtualTour_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Panorama" ADD CONSTRAINT "Panorama_virtualTourId_fkey" FOREIGN KEY ("virtualTourId") REFERENCES "VirtualTour"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hotspot" ADD CONSTRAINT "Hotspot_originId_fkey" FOREIGN KEY ("originId") REFERENCES "Panorama"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hotspot" ADD CONSTRAINT "Hotspot_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Panorama"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_panoramaId_fkey" FOREIGN KEY ("panoramaId") REFERENCES "Panorama"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Share" ADD CONSTRAINT "Share_virtualTourId_fkey" FOREIGN KEY ("virtualTourId") REFERENCES "VirtualTour"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Share" ADD CONSTRAINT "Share_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Visitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "View" ADD CONSTRAINT "View_virtualTourId_fkey" FOREIGN KEY ("virtualTourId") REFERENCES "VirtualTour"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "View" ADD CONSTRAINT "View_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Visitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

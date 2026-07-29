import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding...');

  // Agency
  const agency = await prisma.agency.upsert({
    where: { taxId: '12.345.678/0001-99' },
    update: {},
    create: {
      name: 'Imobiliária Relax Inn',
      taxId: '12.345.678/0001-99',
      email: 'contato@relaxinn.com.br',
      phone: '(51) 99999-0000',
    },
  });

  // Admin
  const adminPassword = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@relaxinn.com.br' },
    update: {},
    create: {
      name: 'Admin Relax Inn',
      email: 'admin@relaxinn.com.br',
      password: adminPassword,
      type: 'ADMINISTRATOR',
      agencyId: agency.id,
    },
  });

  // Agent
  const agentPassword = await bcrypt.hash('corretor123', 10);
  const agent = await prisma.user.upsert({
    where: { email: 'corretor@relaxinn.com.br' },
    update: {},
    create: {
      name: 'João Corretor',
      email: 'corretor@relaxinn.com.br',
      password: agentPassword,
      type: 'AGENT',
      licenseNumber: 'CRECI-RS 12345',
      agencyId: agency.id,
    },
  });

  // Property 1 — com tour virtual
  const property1 = await prisma.property.upsert({
    where: { code: 'RLX-001' },
    update: {},
    create: {
      code: 'RLX-001',
      title: 'Apartamento Relax Inn — Suíte Premium',
      description: 'Apartamento mobiliado com vista para o jardim, ideal para temporada.',
      type: 'APARTMENT',
      purpose: 'RENT',
      price: 850.00,
      totalArea: 45.5,
      status: 'AVAILABLE',
      agencyId: agency.id,
      agentId: agent.id,
      address: {
        create: {
          street: 'Rua das Acácias',
          number: '320',
          complement: 'Apto 12',
          district: 'Moinhos de Vento',
          city: 'Porto Alegre',
          state: 'RS',
          zipCode: '90035-060',
        },
      },
    },
  });

  // Property 2 — sem tour
  await prisma.property.upsert({
    where: { code: 'RLX-002' },
    update: {},
    create: {
      code: 'RLX-002',
      title: 'Casa com Jardim — Bairro Jardim',
      description: 'Casa espaçosa com jardim e garagem para dois carros.',
      type: 'HOUSE',
      purpose: 'SALE',
      price: 650000.00,
      totalArea: 180.0,
      status: 'AVAILABLE',
      agencyId: agency.id,
      agentId: agent.id,
      address: {
        create: {
          street: 'Av. dos Ipês',
          number: '85',
          district: 'Jardim Botânico',
          city: 'Porto Alegre',
          state: 'RS',
          zipCode: '90690-000',
        },
      },
    },
  });

  // Virtual Tour para property1
  const existingTour = await prisma.virtualTour.findUnique({
    where: { propertyId: property1.id },
  });

  if (!existingTour) {
    const imagePath = path.resolve(__dirname, '../relax_inn.jpg');
    const imageData = fs.readFileSync(imagePath).toString('base64');

    const tour = await prisma.virtualTour.create({
      data: {
        propertyId: property1.id,
        status: 'PUBLISHED',
      },
    });

    const sala = await prisma.panorama.create({
      data: {
        virtualTourId: tour.id,
        roomName: 'Sala de Estar',
        imageData,
        order: 0,
        initialPanorama: true,
      },
    });

    const quarto = await prisma.panorama.create({
      data: {
        virtualTourId: tour.id,
        roomName: 'Quarto',
        imageData,
        order: 1,
        initialPanorama: false,
      },
    });

    // Hotspot: sala → quarto
    await prisma.hotspot.create({
      data: {
        originId: sala.id,
        targetId: quarto.id,
        label: 'Ir para o Quarto',
        positionX: 0.65,
        positionY: 0.5,
      },
    });

    // Hotspot: quarto → sala
    await prisma.hotspot.create({
      data: {
        originId: quarto.id,
        targetId: sala.id,
        label: 'Voltar para a Sala',
        positionX: 0.2,
        positionY: 0.5,
      },
    });

    // Medidas da sala
    await prisma.measurement.createMany({
      data: [
        { panoramaId: sala.id, description: 'Largura', value: 4.5, unit: 'm' },
        { panoramaId: sala.id, description: 'Comprimento', value: 5.2, unit: 'm' },
      ],
    });

    // Medidas do quarto
    await prisma.measurement.createMany({
      data: [
        { panoramaId: quarto.id, description: 'Largura', value: 3.2, unit: 'm' },
        { panoramaId: quarto.id, description: 'Comprimento', value: 3.8, unit: 'm' },
      ],
    });

    // Visitors
    const [v1, v2, v3] = await Promise.all([
      prisma.visitor.create({ data: { sessionId: 'sess-seed-001' } }),
      prisma.visitor.create({ data: { sessionId: 'sess-seed-002' } }),
      prisma.visitor.create({ data: { sessionId: 'sess-seed-003' } }),
    ]);

    // Views
    await prisma.view.createMany({
      data: [
        { virtualTourId: tour.id, visitorId: v1.id, durationSeconds: 185, device: 'desktop', viewedAt: new Date('2026-06-20T10:15:00Z') },
        { virtualTourId: tour.id, visitorId: v1.id, durationSeconds: 240, device: 'desktop', viewedAt: new Date('2026-06-22T14:30:00Z') },
        { virtualTourId: tour.id, visitorId: v2.id, durationSeconds: 95,  device: 'mobile',  viewedAt: new Date('2026-06-23T09:00:00Z') },
        { virtualTourId: tour.id, visitorId: v2.id, durationSeconds: 310, device: 'mobile',  viewedAt: new Date('2026-06-25T18:45:00Z') },
        { virtualTourId: tour.id, visitorId: v3.id, durationSeconds: 60,  device: 'tablet',  viewedAt: new Date('2026-06-26T11:20:00Z') },
      ],
    });

    // Shares
    await prisma.share.createMany({
      data: [
        { virtualTourId: tour.id, visitorId: v1.id, channel: 'whatsapp', sharedAt: new Date('2026-06-22T14:35:00Z') },
        { virtualTourId: tour.id, visitorId: v2.id, channel: 'whatsapp', sharedAt: new Date('2026-06-25T18:50:00Z') },
        { virtualTourId: tour.id, visitorId: v3.id, channel: 'email',    sharedAt: new Date('2026-06-26T11:25:00Z') },
      ],
    });

    console.log(`Tour virtual criado: ${tour.id}`);
  }

  console.log('Seed concluído.');
  console.log(`  Agency:    ${agency.name} (${agency.id})`);
  console.log(`  Admin:     ${admin.email} / admin123`);
  console.log(`  Corretor:  ${agent.email} / corretor123`);
  console.log(`  Imóveis:   RLX-001 (com tour), RLX-002`);
  console.log(`  Analytics: 3 visitors, 5 views, 3 shares`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

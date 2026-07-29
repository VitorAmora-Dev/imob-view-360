import { z } from 'zod';

export const MeasurementInputSchema = z.object({
  description: z.string().min(1),
  value: z.number().positive(),
  unit: z.string().min(1).default('m'),
});

export const HotspotInputSchema = z.object({
  label: z.string().optional(),
  positionX: z.number(),
  positionY: z.number(),
  targetTempId: z.string().min(1),
});

export const PanoramaInputSchema = z.object({
  tempId: z.string().min(1),
  roomName: z.string().min(1),
  imageData: z.string().min(1),
  order: z.number().int().min(0).default(0),
  initialPanorama: z.boolean().default(false),
  measurements: z.array(MeasurementInputSchema).default([]),
  hotspots: z.array(HotspotInputSchema).default([]),
});

export const CreateVirtualTourSchema = z.object({
  propertyId: z.string().uuid(),
  panoramas: z.array(PanoramaInputSchema).default([]),
});

export type CreateVirtualTourDto = z.infer<typeof CreateVirtualTourSchema>;

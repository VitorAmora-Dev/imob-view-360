export interface VirtualTour {
  id: string;
  status: string;
  propertyId: string;
  createdAt: string;
  updatedAt: string;
  panoramas: Panorama[];
}

export interface Panorama {
  id: string;
  roomName: string;
  imageData: string;
  order: number;
  initialPanorama: boolean;
  originHotspots: Hotspot[];
  measurements: Measurement[];
}

export interface Hotspot {
  id: string;
  label?: string;
  positionX: number;
  positionY: number;
  targetId: string;
}

export interface Measurement {
  id: string;
  description: string;
  value: number;
  unit: string;
}

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
  /**
   * Caminho relativo à raiz da API (`/panoramas/:id/image?v=…`), não a foto.
   *
   * O tour trazia a equirretangular inteira em base64 dentro deste JSON — o
   * maior tour publicado saía com 58,4 MB numa resposta só, e o visitante
   * pagava por todos os cômodos antes de ver o primeiro. Agora cada cômodo tem
   * endereço próprio, que o navegador busca quando precisa e guarda em cache
   * separado dos outros.
   *
   * Relativo porque o servidor não sabe por qual hostname está sendo acessado
   * (proxy em dev, túnel no celular, outro domínio em produção). Quem monta o
   * endereço final é `VirtualTourService.urlDaImagem`.
   */
  imageUrl: string;
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

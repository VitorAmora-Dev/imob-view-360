/**
 * Valores que a API aceita nos enums de imóvel.
 *
 * Moram aqui, e não no modelo do wizard, porque são vocabulário do domínio: o
 * wizard escolhe um deles ao cadastrar, e a home filtra por eles. A tradução
 * dos rótulos vive no i18n, sob `UPLOAD.TYPE.*` e `UPLOAD.PURPOSE.*`.
 */
export const PROPERTY_TYPES = [
  'HOUSE',
  'APARTMENT',
  'LAND',
  'COMMERCIAL',
  'RURAL',
  'OFFICE',
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const PROPERTY_PURPOSES = ['SALE', 'RENT', 'SALE_OR_RENT'] as const;
export type PropertyPurpose = (typeof PROPERTY_PURPOSES)[number];

export interface Property {
  id: string;
  code: string;
  title: string;
  description?: string;
  type: string;
  purpose: string;
  price?: number;
  totalArea?: number;
  status: string;
  agencyId: string;
  agentId?: string;
  createdAt: string;
  updatedAt: string;
  address?: {
    street: string;
    number?: string;
    complement?: string;
    district?: string;
    city: string;
    state: string;
    zipCode?: string;
  };
  virtualTour?: { id: string; status: string } | null;
}

export interface PaginatedProperties {
  data: Property[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface ListPropertiesParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  type?: string;
  purpose?: string;
  city?: string;
  state?: string;
  /** Bairro, cidade ou estado — o servidor casa qualquer um dos três. */
  location?: string;
}

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
}

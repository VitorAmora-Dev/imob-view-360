export interface UserProfile {
  id: string;
  name: string;
  email: string;
  type: 'ADMINISTRATOR' | 'AGENT';
  licenseNumber?: string;
  agencyId: string;
  createdAt: string;
  updatedAt: string;
}

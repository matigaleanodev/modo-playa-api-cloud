import type { DestinationId } from '../providers/destination-id.enum.ts';

export interface DestinationConfig {
  id: DestinationId;
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

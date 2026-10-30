import type { CreateLodgingInput } from '@modo-playa/contracts/business';
export const lodgingInput = {
  title: 'Casa',
  description: 'Playa',
  location: 'Centro',
  city: 'Mar Azul',
  type: 'house',
  price: 100,
  priceUnit: 'night',
  maxGuests: 4,
  bedrooms: 2,
  bathrooms: 1,
  minNights: 2,
  amenities: ['wifi'],
} satisfies CreateLodgingInput;

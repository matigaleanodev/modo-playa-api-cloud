import { Schema, type Connection, type HydratedDocument, type Types } from 'mongoose';
import type { CreateLodgingInput } from '@modo-playa/contracts/business';
export interface Contact {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  name: string;
  email?: string;
  whatsapp?: string;
  isDefault: boolean;
  active: boolean;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}
export type ContactDocument = HydratedDocument<Contact>;
export const contactSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true },
    whatsapp: { type: String, trim: true },
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
    isDefault: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    notes: String,
  },
  {
    collection: 'contacts',
    timestamps: true,
    autoIndex: false,
    autoCreate: false,
    bufferCommands: false,
  },
);
contactSchema.index(
  { ownerId: 1, isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } },
);
export interface LodgingImage {
  imageId: string;
  key: string;
  isDefault: boolean;
  width?: number;
  height?: number;
  bytes?: number;
  mime?: string;
  createdAt: Date;
}
export interface Lodging extends Omit<
  CreateLodgingInput,
  | 'contactId'
  | 'occupiedRanges'
  | 'pendingImageIds'
  | 'uploadSessionId'
  | 'targetOwnerId'
  | 'mainImage'
  | 'images'
  | 'amenities'
> {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  contactId?: Types.ObjectId;
  amenities: NonNullable<CreateLodgingInput['amenities']>;
  mainImage: string;
  images: string[];
  mediaImages: LodgingImage[];
  occupiedRanges: { from: Date; to: Date }[];
  pendingImageUploads: {
    imageId: string;
    stagingKey: string;
    createdAt: Date;
    expiresAt: Date;
    status: 'PENDING';
  }[];
  createdAt: Date;
  updatedAt: Date;
}
export type LodgingDocument = HydratedDocument<Lodging>;
const lodgingImageSchema = new Schema(
  {
    imageId: { type: String, required: true },
    key: { type: String, required: true },
    isDefault: { type: Boolean, required: true, default: false },
    width: Number,
    height: Number,
    bytes: Number,
    mime: String,
    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { _id: false, versionKey: false },
);
const pendingImageSchema = new Schema(
  {
    imageId: { type: String, required: true },
    stagingKey: { type: String, required: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    expiresAt: { type: Date, required: true },
    status: { type: String, required: true, enum: ['PENDING'], default: 'PENDING' },
  },
  { _id: false, versionKey: false },
);
const rangeSchema = new Schema(
  { from: { type: Date, required: true }, to: { type: Date, required: true } },
  { _id: false },
);
import { amenities, lodgingTypes, priceUnits } from '@modo-playa/contracts/business';
export const lodgingSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    location: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    type: { type: String, required: true, enum: lodgingTypes },
    price: { type: Number, required: true, min: 0 },
    priceUnit: { type: String, required: true, enum: priceUnits },
    maxGuests: { type: Number, required: true, min: 1 },
    bedrooms: { type: Number, required: true, min: 0 },
    bathrooms: { type: Number, required: true, min: 0 },
    minNights: { type: Number, required: true, min: 1 },
    distanceToBeach: { type: Number, min: 0 },
    amenities: { type: [String], enum: amenities, default: [] },
    mainImage: { type: String, required: true },
    images: { type: [String], default: [] },
    mediaImages: { type: [lodgingImageSchema], default: [] },
    pendingImageUploads: { type: [pendingImageSchema], default: [] },
    occupiedRanges: { type: [rangeSchema], default: [] },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact' },
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
    isPubliclyVisible: { type: Boolean, default: true },
  },
  {
    collection: 'lodgings',
    timestamps: true,
    autoIndex: false,
    autoCreate: false,
    bufferCommands: false,
  },
);
lodgingSchema.index({ isPubliclyVisible: 1, createdAt: -1 });
lodgingSchema.index({ isPubliclyVisible: 1, city: 1, createdAt: -1 });
lodgingSchema.index({ isPubliclyVisible: 1, price: 1 });
lodgingSchema.index({ isPubliclyVisible: 1, maxGuests: 1 });
export function businessModels(connection: Connection) {
  return {
    contacts: connection.model<ContactDocument>('Contact', contactSchema),
    lodgings: connection.model<LodgingDocument>('Lodging', lodgingSchema),
  };
}

import { Schema, type Connection, type HydratedDocument, type Types } from 'mongoose';
export interface PendingLodgingDraftImageUpload {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  uploadSessionId: string;
  imageId: string;
  stagingKey: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  status: 'PENDING' | 'CONFIRMED';
}
export type PendingLodgingDraftImageUploadDocument =
  HydratedDocument<PendingLodgingDraftImageUpload>;
export const pendingDraftSchema = new Schema<PendingLodgingDraftImageUpload>(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
    uploadSessionId: { type: String, required: true, index: true, trim: true },
    imageId: { type: String, required: true },
    stagingKey: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    status: { type: String, required: true, enum: ['PENDING', 'CONFIRMED'], default: 'PENDING' },
  },
  {
    collection: 'pendinglodgingdraftimageuploads',
    timestamps: true,
    versionKey: false,
    autoCreate: false,
    autoIndex: false,
    bufferCommands: false,
  },
);
pendingDraftSchema.index({ ownerId: 1, uploadSessionId: 1, imageId: 1 }, { unique: true });
pendingDraftSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export function pendingDraftModel(connection: Connection) {
  return connection.model<PendingLodgingDraftImageUpload>(
    'PendingLodgingDraftImageUpload',
    pendingDraftSchema,
  );
}

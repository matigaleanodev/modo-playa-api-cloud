import { Types } from 'mongoose';
import { DomainException } from '../identity/errors.ts';
export function toObjectIdOrThrow(
  value: string,
  options: { message: string; errorCode: string; httpStatus: number },
) {
  if (!Types.ObjectId.isValid(value))
    throw new DomainException(options.message, options.errorCode, options.httpStatus);
  return new Types.ObjectId(value);
}

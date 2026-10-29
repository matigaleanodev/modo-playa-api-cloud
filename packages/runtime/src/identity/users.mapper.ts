import type { User } from './models.ts';
import type { MediaUrlBuilder } from './media-urls.ts';
export class UsersMapper {
  static toResponse(user: User, mediaUrlBuilder?: MediaUrlBuilder) {
    const profileImage = user.profileImage
      ? {
          imageId: user.profileImage.imageId,
          key: user.profileImage.key,
          width: user.profileImage.width,
          height: user.profileImage.height,
          bytes: user.profileImage.bytes,
          mime: user.profileImage.mime,
          createdAt: user.profileImage.createdAt.toISOString(),
          url: mediaUrlBuilder
            ? mediaUrlBuilder.buildPublicUrl(user.profileImage.key)
            : user.profileImage.key,
          variants: mediaUrlBuilder
            ? mediaUrlBuilder.buildLodgingVariants(user.profileImage.key)
            : undefined,
        }
      : undefined;

    return {
      id: user._id.toString(),
      email: user.email,
      username: user.username,
      isPasswordSet: user.isPasswordSet,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      avatarUrl: profileImage?.url ?? user.avatarUrl,
      profileImage,
      phone: user.phone,
    };
  }
}

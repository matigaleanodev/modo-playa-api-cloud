export interface MediaUrlVariants {
  thumb: string;
  card: string;
  hero: string;
}
export interface MediaUrlBuilder {
  buildPublicUrl(key: string): string;
  buildLodgingVariants(key: string): MediaUrlVariants;
}
export class CloudflareMediaUrlBuilderService implements MediaUrlBuilder {
  private readonly baseUrl: string;
  private readonly supportsCloudflareImageResizing: boolean;
  private readonly baseHost?: string;
  private readonly r2EndpointHost?: string;
  private readonly bucketName: string;

  constructor(config: { publicBaseUrl: string; r2Endpoint: string; r2Bucket: string }) {
    const configured = config.publicBaseUrl;
    const r2Endpoint = config.r2Endpoint;
    this.bucketName = config.r2Bucket;
    this.baseUrl = configured.replace(/\/+$/, '');
    this.baseHost = this.getHostname(this.baseUrl);
    this.r2EndpointHost = this.getHostname(r2Endpoint);
    this.supportsCloudflareImageResizing = this.detectCloudflareImageResizingSupport(this.baseUrl);
  }

  buildPublicUrl(key: string): string {
    const normalizedAbsoluteKey = this.tryExtractConvertibleKey(key);

    if (normalizedAbsoluteKey) {
      return `${this.baseUrl}/${this.normalizeKey(normalizedAbsoluteKey)}`;
    }

    if (this.isAbsoluteUrl(key)) {
      return key;
    }

    return `${this.baseUrl}/${this.normalizeKey(key)}`;
  }

  buildLodgingVariants(key: string): MediaUrlVariants {
    const normalizedAbsoluteKey = this.tryExtractConvertibleKey(key);
    const sourceKey = normalizedAbsoluteKey ?? key;

    if (this.isAbsoluteUrl(sourceKey)) {
      return {
        thumb: sourceKey,
        card: sourceKey,
        hero: sourceKey,
      };
    }

    if (!this.supportsCloudflareImageResizing) {
      const originalUrl = this.buildPublicUrl(sourceKey);

      return {
        thumb: originalUrl,
        card: originalUrl,
        hero: originalUrl,
      };
    }

    const normalizedKey = this.normalizeKey(sourceKey);

    return {
      thumb: this.buildTransformationUrl(
        'width=320,height=240,fit=cover,quality=80,format=auto',
        normalizedKey,
      ),
      card: this.buildTransformationUrl(
        'width=640,height=420,fit=cover,quality=82,format=auto',
        normalizedKey,
      ),
      hero: this.buildTransformationUrl(
        'width=1600,height=900,fit=cover,quality=85,format=auto',
        normalizedKey,
      ),
    };
  }

  private buildTransformationUrl(options: string, normalizedKey: string): string {
    return `${this.baseUrl}/cdn-cgi/image/${options}/${normalizedKey}`;
  }

  private normalizeKey(key: string): string {
    return key
      .split('/')
      .filter((segment) => segment.length > 0)
      .map((segment) => encodeURIComponent(segment))
      .join('/');
  }

  private isAbsoluteUrl(value: string): boolean {
    return /^https?:\/\//i.test(value);
  }

  private tryExtractConvertibleKey(value: string): string | undefined {
    if (!this.isAbsoluteUrl(value)) {
      return undefined;
    }

    try {
      const url = new URL(value);
      const hostname = url.hostname.toLowerCase();
      const shouldConvert = this.hasAwsSignature(url) || this.isKnownStorageHost(hostname);

      if (!shouldConvert) {
        return undefined;
      }

      const segments = url.pathname.split('/').filter((segment) => segment.length > 0);

      if (segments.length === 0) {
        return undefined;
      }

      if (this.bucketName && segments[0] === this.bucketName) {
        segments.shift();
      }

      if (segments.length === 0) {
        return undefined;
      }

      return segments.join('/');
    } catch {
      return undefined;
    }
  }

  private hasAwsSignature(url: URL): boolean {
    return (
      url.searchParams.has('X-Amz-Algorithm') ||
      url.searchParams.has('X-Amz-Credential') ||
      url.searchParams.has('X-Amz-Signature')
    );
  }

  private isKnownStorageHost(hostname: string): boolean {
    return (
      hostname === this.baseHost ||
      hostname === this.r2EndpointHost ||
      hostname.endsWith('.r2.cloudflarestorage.com') ||
      hostname.endsWith('.r2.dev')
    );
  }

  private getHostname(value: string): string | undefined {
    try {
      return new URL(value).hostname.toLowerCase();
    } catch {
      return undefined;
    }
  }

  private detectCloudflareImageResizingSupport(baseUrl: string): boolean {
    try {
      const hostname = new URL(baseUrl).hostname.toLowerCase();

      // r2.dev no admite transformaciones /cdn-cgi/image.
      if (hostname.endsWith('.r2.dev')) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }
}

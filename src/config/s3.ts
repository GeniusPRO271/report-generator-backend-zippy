import { S3Client } from "@aws-sdk/client-s3";

export const s3Config = {
  endpoint: process.env.DO_SPACES_ENDPOINT!,
  region: process.env.DO_SPACES_REGION || "nyc3",
  bucket: process.env.DO_SPACES_BUCKET!,
  prefix: (process.env.DO_SPACES_PREFIX || "reports/").replace(/\/?$/, "/"),
  presignedUrlExpiresIn: 15 * 60, // 15 minutes
};

if (!s3Config.endpoint) {
  throw new Error("DO_SPACES_ENDPOINT environment variable is required");
}

if (!s3Config.bucket) {
  throw new Error("DO_SPACES_BUCKET environment variable is required");
}

export const s3Client = new S3Client({
  endpoint: s3Config.endpoint,
  region: s3Config.region,
  forcePathStyle: false,
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY!,
    secretAccessKey: process.env.DO_SPACES_SECRET!,
  },
});

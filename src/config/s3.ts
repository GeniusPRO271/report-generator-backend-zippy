import { S3Client } from "@aws-sdk/client-s3";

export const s3Config = {
  region: process.env.AWS_REGION || "us-east-1",
  bucket: process.env.AWS_S3_BUCKET!,
  prefix: process.env.AWS_S3_PREFIX || "reports/",
  presignedUrlExpiresIn: 15 * 60, // 15 minutes
};

if (!s3Config.bucket) {
  throw new Error("AWS_S3_BUCKET environment variable is required");
}

export const s3Client = new S3Client({
  region: s3Config.region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

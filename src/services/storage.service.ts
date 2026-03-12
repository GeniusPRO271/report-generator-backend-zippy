import { createReadStream, unlinkSync, statSync } from "node:fs";
import path from "node:path";
import { Service } from "typedi";
import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { s3Client, s3Config } from "../config/s3";

@Service()
export class StorageService {
  async upload(filePath: string): Promise<string> {
    const fileName = path.basename(filePath);
    const s3Key = `${s3Config.prefix}${fileName}`;
    const contentType = this.resolveContentType(fileName);
    const fileSize = statSync(filePath).size;
    const body = createReadStream(filePath);

    await s3Client.send(
      new PutObjectCommand({
        Bucket: s3Config.bucket,
        Key: s3Key,
        Body: body,
        ContentType: contentType,
        ContentDisposition: `attachment; filename="${fileName}"`,
        ContentLength: fileSize,
      }),
    );

    unlinkSync(filePath);

    return s3Key;
  }

  async getPresignedUrl(s3Key: string): Promise<string> {
    return getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: s3Config.bucket,
        Key: s3Key,
      }),
      { expiresIn: s3Config.presignedUrlExpiresIn },
    );
  }

  async delete(s3Key: string): Promise<void> {
    if (!s3Key.startsWith(s3Config.prefix)) {
      throw new Error("Invalid storage key");
    }

    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: s3Config.bucket,
        Key: s3Key,
      }),
    );
  }

  private resolveContentType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();

    switch (ext) {
      case ".xlsx":
        return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      case ".xls":
        return "application/vnd.ms-excel";
      case ".csv":
        return "text/csv; charset=utf-8";
      default:
        return "application/octet-stream";
    }
  }
}

import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export { cloudinary };

export async function uploadFile(
  filePath: string,
  options: { folder?: string; publicId?: string } = {},
) {
  return cloudinary.uploader.upload(filePath, {
    folder: options.folder || 'placementiq/resumes',
    public_id: options.publicId,
    resource_type: 'raw',
  });
}

export async function deleteFile(publicId: string) {
  return cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
}

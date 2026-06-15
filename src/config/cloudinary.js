const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function parseCloudinaryUrl(url) {
  if (!url || !url.includes('cloudinary.com')) return null;
  const match = url.match(/cloudinary\.com\/[^/]+\/(image|raw|video)\/upload\/(?:v\d+\/)?(.+)\.[^.]+$/);
  if (!match) return null;
  return { resource_type: match[1], public_id: match[2] };
}

async function deleteFromCloudinary(url) {
  const parsed = parseCloudinaryUrl(url);
  if (!parsed) return;
  try {
    await cloudinary.uploader.destroy(parsed.public_id, { resource_type: parsed.resource_type });
  } catch (_) {}
}

async function uploadBufferToCloudinary(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
    Readable.from(buffer).pipe(stream);
  });
}

module.exports = { cloudinary, deleteFromCloudinary, uploadBufferToCloudinary };

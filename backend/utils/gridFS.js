// backend/utils/gridFS.js
const mongoose = require('mongoose');
let bucket;

function getBucket() {
  if (!bucket && mongoose.connection.db) {
    bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'fs' });
  }
  if (!bucket) throw new Error('GridFS is not available before the database connection is open');
  return bucket;
}

/**
 * Upload a buffer to GridFS and return the generated file ObjectId.
 * @param {Buffer} buffer - File data.
 * @param {string} filename - Original file name.
 * @param {string} mimetype - MIME type of the file.
 */
function uploadFile(buffer, filename, mimetype) {
  return new Promise((resolve, reject) => {
    let writeStream;
    try {
      writeStream = getBucket().openUploadStream(filename, {
        contentType: mimetype,
      });
    } catch (error) {
      reject(error);
      return;
    }

    writeStream.on('finish', () => resolve(writeStream.id));
    writeStream.on('error', reject);
    writeStream.end(buffer);
  });
}

/** Delete a GridFS file by its ObjectId */
function deleteFile(id) {
  return getBucket().delete(id);
}

/** Get a readable stream for a stored GridFS file */
function getFileStream(id) {
  return getBucket().openDownloadStream(id);
}

module.exports = {
  uploadFile,
  deleteFile,
  getFileStream,
};

import express from "express";
import multer from "multer";
import { uploadToR2, deleteFromR2, extractKeyFromUrl } from "../utils/r2.js";
import { authenticate } from "../middleware/auth.js";

const router = express.Router();

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only image files
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(
      file.originalname.toLowerCase().split(".").pop()
    );
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error("Only image files (jpg, png, webp) are allowed"));
    }
  },
});

// POST /api/upload - Upload single or multiple images
router.post("/", authenticate, upload.array("images", 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "No files uploaded" });
    }

    const uploadedUrls = [];
    const { folder } = req.body; // e.g., "properties" or "agencies"

    for (const file of req.files) {
      // Generate unique filename
      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substring(2, 15);
      const extension = file.originalname.split(".").pop();
      const filename = `${timestamp}-${randomString}.${extension}`;

      // Construct key based on folder and user
      const userId = req.user?._id || req.agency?._id;
      const key = folder
        ? `${folder}/${userId}/${filename}`
        : `uploads/${userId}/${filename}`;

      // Upload to R2
      const url = await uploadToR2(file.buffer, key, file.mimetype);
      uploadedUrls.push(url);
    }

    res.status(200).json({
      message: "Files uploaded successfully",
      urls: uploadedUrls,
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({
      message: error.message || "Failed to upload files",
    });
  }
});

// DELETE /api/upload - Delete image by URL
router.delete("/", authenticate, async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ message: "URL is required" });
    }

    const key = extractKeyFromUrl(url);
    if (!key) {
      return res.status(400).json({ message: "Invalid R2 URL" });
    }

    await deleteFromR2(key);

    res.status(200).json({
      message: "File deleted successfully",
    });
  } catch (error) {
    console.error("Delete error:", error);
    res.status(500).json({
      message: error.message || "Failed to delete file",
    });
  }
});

export default router;

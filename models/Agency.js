import mongoose from "mongoose";

const agencySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  passwordHash: {
    type: String,
    required: true,
  },
  category: {
    type: [String],
    required: true,
    enum: [
      "sim",
      "bank",
      "insurance",
      "visa",
      "travel",
      "property",
      "relocation",
      "business",
      "electricity",
    ],
  },
  about: {
    type: String,
    default: "",
  },
  phone: {
    type: String,
    required: true,
  },
  website: {
    type: String,
    default: "",
  },
  address: {
    type: String,
    default: "",
  },
  city: {
    type: String,
    required: true,
  },
  country: {
    type: String,
    required: true,
    trim: true,
  },
  logoUrl: {
    type: String,
    default: "",
  },
  images: {
    type: [
      {
        url: {
          type: String,
          required: true,
        },
        isThumbnail: {
          type: Boolean,
          default: false,
        },
        category: {
          type: String,
          default: "",
        },
      },
    ],
    default: [],
  },
  isApproved: {
    type: Boolean,
    default: false,
  },
  /** When false, agency is hidden from public listings and cannot use the API or log in. */
  isActive: {
    type: Boolean,
    default: true,
  },
  // Professional enhancement fields
  businessHours: {
    type: String,
    default: "",
  },
  languages: {
    type: [String],
    default: [],
  },
  socialMedia: {
    facebook: { type: String, default: "" },
    instagram: { type: String, default: "" },
    linkedin: { type: String, default: "" },
    twitter: { type: String, default: "" },
    whatsapp: { type: String, default: "" },
  },
  yearsInBusiness: {
    type: Number,
    default: 0,
  },
  certifications: {
    type: [String],
    default: [],
  },
  serviceAreas: {
    type: [String], // Additional cities/countries served
    default: [],
  },
  latitude: {
    type: Number,
  },
  longitude: {
    type: Number,
  },
  fcmTokens: {
    type: [
      {
        token: { type: String, required: true },
        platform: { type: String, enum: ["android", "ios"], default: "android" },
        updatedAt: { type: Date, default: Date.now },
      },
    ],
    default: [],
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Country is now a string, no need to populate

export default mongoose.model("Agency", agencySchema);

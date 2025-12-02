import mongoose from "mongoose";

const propertySchema = new mongoose.Schema({
  ownerType: {
    type: String,
    required: true,
    enum: ["User", "Agency"],
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: "ownerType",
  },
  title: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    required: true,
  },
  price: {
    type: Number,
    required: true,
  },
  currency: {
    type: String,
    default: "USD",
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
  photos: {
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
  // New enhanced fields
  bedrooms: {
    type: Number,
    min: 0,
  },
  bathrooms: {
    type: Number,
    min: 0,
  },
  area: {
    type: Number,
    min: 0,
  },
  areaUnit: {
    type: String,
    enum: ["sqft", "sqm"],
    default: "sqft",
  },
  propertyType: {
    type: String,
    enum: [
      "apartment",
      "house",
      "studio",
      "condo",
      "townhouse",
      "villa",
      "other",
    ],
  },
  amenities: {
    type: [String],
    default: [],
  },
  furnished: {
    type: Boolean,
    default: false,
  },
  petsAllowed: {
    type: Boolean,
    default: false,
  },
  availableFrom: {
    type: Date,
  },
  latitude: {
    type: Number,
  },
  longitude: {
    type: Number,
  },
  views: {
    type: Number,
    default: 0,
  },
  featured: {
    type: Boolean,
    default: false,
  },
  active: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Indexes for better query performance
propertySchema.index({ city: 1, country: 1 });
propertySchema.index({ propertyType: 1 });
propertySchema.index({ price: 1 });
propertySchema.index({ featured: 1, createdAt: -1 });
propertySchema.index({ active: 1, createdAt: -1 });

// Fix refPath by mapping to actual model names
propertySchema.pre(/^find/, function (next) {
  this.populate({
    path: "owner",
    select: "name email phone",
    strictPopulate: false, // Don't throw error if owner doesn't exist
  });
  // Country is now a string, no need to populate
  next();
});

export default mongoose.model("Property", propertySchema);

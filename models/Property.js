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
  address: {
    type: String,
    trim: true,
    default: "",
  },
  nearbyPlaces: {
    type: String,
    trim: true,
    default: "",
  },
  nearbyUniversities: {
    type: [
      {
        name: { type: String, required: true, trim: true },
        miles: { type: Number, required: true, min: 0 },
      },
    ],
    default: [],
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
      "project",
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
  featuredUntil: {
    type: Date,
    default: null,
  },
  active: {
    type: Boolean,
    default: true,
  },
  soldOut: {
    type: Boolean,
    default: false,
  },
  projectUrl: {
    type: String,
    trim: true,
    default: "",
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

// Post-find hook to automatically clean up expired featured properties
propertySchema.post(/^find/, async function (docs) {
  if (!docs) return;
  
  const now = new Date();
  const docsArray = Array.isArray(docs) ? docs : [docs];
  
  for (const doc of docsArray) {
    if (doc && doc.featured && doc.featuredUntil && new Date(doc.featuredUntil) < now) {
      // Property has expired, update it
      doc.featured = false;
      doc.featuredUntil = null;
      await doc.save({ validateBeforeSave: false });
    }
  }
});

export default mongoose.model("Property", propertySchema);

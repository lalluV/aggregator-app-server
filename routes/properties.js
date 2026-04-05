import express from "express";
import Property from "../models/Property.js";
import Interest from "../models/Interest.js";
import PropertyRequirement from "../models/PropertyRequirement.js";
import { authenticate, isCustomerOrAgency } from "../middleware/auth.js";

const router = express.Router();

// POST /api/properties - Create property
router.post("/", authenticate, isCustomerOrAgency, async (req, res) => {
  try {
    const {
      title,
      description,
      price,
      currency,
      city,
      country,
      address,
      nearbyPlaces,
      nearbyUniversities,
      photos,
      bedrooms,
      bathrooms,
      area,
      areaUnit,
      propertyType,
      amenities,
      furnished,
      petsAllowed,
      availableFrom,
      latitude,
      longitude,
    } = req.body;

    if (!title || !description || !price || !city || !country) {
      return res.status(400).json({
        message: "Required fields: title, description, price, city, country",
      });
    }

    const normalizedUniversities = Array.isArray(nearbyUniversities)
      ? nearbyUniversities
          .filter(
            (u) =>
              u &&
              String(u.name || "").trim() &&
              typeof u.miles === "number" &&
              !Number.isNaN(u.miles) &&
              u.miles > 0,
          )
          .map((u) => ({
            name: String(u.name).trim(),
            miles: Number(u.miles),
          }))
      : [];

    if (normalizedUniversities.length < 1) {
      return res.status(400).json({
        message:
          "At least one nearby university with name and distance (miles) greater than 0 is required",
      });
    }

    // Only admin can create "project" type (via /api/admin/properties)
    if (propertyType === "project") {
      return res.status(403).json({
        message:
          "Only admin can create Project properties. Use the admin panel.",
      });
    }

    // Normalize photos: convert strings to objects, ensure objects have required fields
    const normalizedPhotos = Array.isArray(photos)
      ? photos
          .map((photo) => {
            if (typeof photo === "string") {
              // Convert legacy string format to object
              return {
                url: photo,
                isThumbnail: false,
                category: "",
              };
            }
            // Ensure object has required fields
            if (photo && typeof photo === "object") {
              return {
                url: photo.url || "",
                isThumbnail: photo.isThumbnail || false,
                category: photo.category || "",
              };
            }
            return null;
          })
          .filter(Boolean) // Remove any null values
      : [];

    // Validate that if photos exist, at least one must be a thumbnail
    if (normalizedPhotos.length > 0) {
      const hasThumbnail = normalizedPhotos.some(
        (photo) => photo.isThumbnail === true,
      );
      if (!hasThumbnail) {
        return res.status(400).json({
          message: "At least one photo must be set as thumbnail",
        });
      }
    }

    const propertyData = {
      title,
      description,
      price,
      currency: currency || "USD",
      city,
      country,
      address: address || "",
      nearbyPlaces: nearbyPlaces || "",
      nearbyUniversities: normalizedUniversities,
      photos: normalizedPhotos,
      bedrooms: bedrooms ? parseInt(bedrooms) : undefined,
      bathrooms: bathrooms ? parseInt(bathrooms) : undefined,
      area: area ? parseFloat(area) : undefined,
      areaUnit: areaUnit || "sqft",
      propertyType,
      amenities: Array.isArray(amenities) ? amenities : [],
      furnished: furnished === true || furnished === "true",
      petsAllowed: petsAllowed === true || petsAllowed === "true",
      availableFrom: availableFrom ? new Date(availableFrom) : undefined,
      latitude: latitude ? parseFloat(latitude) : undefined,
      longitude: longitude ? parseFloat(longitude) : undefined,
      active: true,
    };

    if (req.userType === "AGENCY") {
      propertyData.ownerType = "Agency";
      propertyData.owner = req.agency._id;
    } else {
      propertyData.ownerType = "User";
      propertyData.owner = req.user._id;
    }

    const property = await Property.create(propertyData);

    res.status(201).json({
      message: "Property created successfully",
      property,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/properties - List all properties
router.get("/", async (req, res) => {
  try {
    const {
      country,
      city,
      minPrice,
      maxPrice,
      q,
      propertyType,
      bedrooms,
      bathrooms,
      amenities,
      furnished,
      petsAllowed,
      featured,
      university,
      maxMiles,
      sort,
      page = 1,
      limit = 20,
    } = req.query;

    let query = { active: true, soldOut: { $ne: true } };

    if (country) {
      // Filter by country name (case-insensitive)
      query.country = new RegExp(`^${country}$`, "i");
    }
    if (city) {
      query.city = new RegExp(city, "i");
    }
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = parseFloat(minPrice);
      if (maxPrice) query.price.$lte = parseFloat(maxPrice);
    }
    if (q) {
      query.$or = [
        { title: new RegExp(q, "i") },
        { description: new RegExp(q, "i") },
      ];
    }
    if (propertyType) {
      query.propertyType = propertyType;
    }
    if (bedrooms) {
      query.bedrooms = { $gte: parseInt(bedrooms) };
    }
    if (bathrooms) {
      query.bathrooms = { $gte: parseInt(bathrooms) };
    }
    if (amenities) {
      const amenityArray = Array.isArray(amenities)
        ? amenities
        : amenities.split(",");
      query.amenities = { $in: amenityArray };
    }
    if (furnished !== undefined) {
      query.furnished = furnished === "true" || furnished === true;
    }
    if (petsAllowed !== undefined) {
      query.petsAllowed = petsAllowed === "true" || petsAllowed === true;
    }
    if (university && maxMiles !== undefined) {
      const miles = parseFloat(maxMiles);
      if (!isNaN(miles) && miles >= 0) {
        query.nearbyUniversities = {
          $elemMatch: {
            name: new RegExp(String(university).trim(), "i"),
            miles: { $lte: miles },
          },
        };
      }
    }
    if (featured !== undefined) {
      if (featured === "true" || featured === true) {
        // Only show featured properties that haven't expired
        query.featured = true;
        query.$or = [
          { featuredUntil: null },
          { featuredUntil: { $gte: new Date() } },
        ];
      }
    }

    // Always exclude expired featured properties from results
    // Add condition to filter out expired featured properties
    const now = new Date();
    if (query.featured === true) {
      // If filtering for featured, ensure they're not expired
      if (!query.$or) {
        query.$or = [{ featuredUntil: null }, { featuredUntil: { $gte: now } }];
      }
    } else {
      // For all properties, exclude expired featured ones
      const existingOr = query.$or || [];
      query.$and = [
        ...(query.$and || []),
        {
          $or: [
            { featured: false },
            {
              featured: true,
              $or: [{ featuredUntil: null }, { featuredUntil: { $gte: now } }],
            },
          ],
        },
      ];
      if (existingOr.length > 0) {
        query.$and.push({ $or: existingOr });
      }
      delete query.$or;
    }

    // Sorting
    let sortOption = { createdAt: -1 };
    switch (sort) {
      case "price-asc":
        sortOption = { price: 1 };
        break;
      case "price-desc":
        sortOption = { price: -1 };
        break;
      case "newest":
        sortOption = { createdAt: -1 };
        break;
      case "oldest":
        sortOption = { createdAt: 1 };
        break;
      case "views":
        sortOption = { views: -1 };
        break;
      case "featured":
        sortOption = { featured: -1, createdAt: -1 };
        break;
      default:
        sortOption = { createdAt: -1 };
    }

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const [properties, total] = await Promise.all([
      Property.find(query).sort(sortOption).skip(skip).limit(limitNum),
      Property.countDocuments(query),
    ]);

    res.json({
      count: properties.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      properties,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/my/properties - My properties (MUST come before /:id route)
router.get(
  "/properties",
  authenticate,
  isCustomerOrAgency,
  async (req, res) => {
    try {
      const query = {
        ownerType: req.userType === "AGENCY" ? "Agency" : "User",
        owner: req.userType === "AGENCY" ? req.agency._id : req.user._id,
      };

      const properties = await Property.find(query).sort({ createdAt: -1 });

      res.json({
        count: properties.length,
        properties,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },
);

// GET /api/my/interests - Interests on my properties (MUST come before /:id route)
router.get("/interests", authenticate, isCustomerOrAgency, async (req, res) => {
  try {
    const ownerId = req.userType === "AGENCY" ? req.agency._id : req.user._id;
    const ownerType = req.userType === "AGENCY" ? "Agency" : "User";

    // Find all properties owned by user
    const properties = await Property.find({
      owner: ownerId,
      ownerType,
    }).select("_id");
    const propertyIds = properties.map((p) => p._id);

    // Find all interests for those properties
    const interests = await Interest.find({ property: { $in: propertyIds } })
      .populate("property", "title city country")
      .sort({ createdAt: -1 });

    res.json({
      count: interests.length,
      interests,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/properties/:id - Property detail
router.get("/:id", async (req, res) => {
  try {
    let { id } = req.params;

    // Clean the ID - remove any trailing characters after a colon (e.g., "id:1" -> "id")
    if (id && id.includes(":")) {
      id = id.split(":")[0];
    }

    // Validate MongoDB ObjectId format
    if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        message: "Invalid property ID format",
        receivedId: req.params.id,
        cleanedId: id,
      });
    }

    const property = await Property.findById(id);

    if (!property) {
      return res.status(404).json({ message: "Property not found" });
    }

    // Increment view counter
    property.views += 1;
    await property.save();

    res.json({ property });
  } catch (error) {
    console.error("Error fetching property:", error);
    console.error("Property ID:", req.params.id);
    res.status(500).json({
      message: error.message || "Failed to fetch property",
      error: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

// POST /api/properties/:id/interest - Submit interest
router.post("/:id/interest", async (req, res) => {
  try {
    const { name, phone, email, message } = req.body;

    if (!name || !phone || !email) {
      return res
        .status(400)
        .json({ message: "Name, phone, and email are required" });
    }

    const property = await Property.findById(req.params.id);
    if (!property) {
      return res.status(404).json({ message: "Property not found" });
    }

    if (property.soldOut) {
      return res.status(400).json({
        message:
          "This property is sold out. Submit requirements instead of interest.",
      });
    }

    const interest = await Interest.create({
      property: req.params.id,
      name,
      phone,
      email,
      message: message || "",
    });

    res.status(201).json({
      message: "Interest submitted successfully",
      interest,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/properties/:id - Update property (owner only)
router.put("/:id", authenticate, isCustomerOrAgency, async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);

    if (!property) {
      return res.status(404).json({ message: "Property not found" });
    }

    // Check ownership
    // Handle populated owner (from pre-find hook) or unpopulated ObjectId
    const propertyOwnerId = (property.owner?._id || property.owner).toString();

    const ownerId = req.userType === "AGENCY" ? req.agency._id : req.user._id;
    const expectedOwnerType = req.userType === "AGENCY" ? "Agency" : "User";

    if (
      propertyOwnerId !== ownerId.toString() ||
      property.ownerType !== expectedOwnerType
    ) {
      return res.status(403).json({
        message: "Not authorized",
        debug: {
          propertyOwnerId,
          propertyOwnerType: property.ownerType,
          authenticatedOwnerId: ownerId?.toString(),
          authenticatedUserType: req.userType,
        },
      });
    }

    // Update allowed fields
    const allowedFields = [
      "title",
      "description",
      "price",
      "currency",
      "city",
      "country",
      "address",
      "nearbyPlaces",
      "nearbyUniversities",
      "photos",
      "bedrooms",
      "bathrooms",
      "area",
      "areaUnit",
      "propertyType",
      "amenities",
      "furnished",
      "petsAllowed",
      "availableFrom",
      "latitude",
      "longitude",
      "active",
      "projectUrl",
      "soldOut",
    ];

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        if (field === "bedrooms" || field === "bathrooms") {
          property[field] = parseInt(req.body[field]);
        } else if (field === "area") {
          property[field] = parseFloat(req.body[field]);
        } else if (field === "latitude" || field === "longitude") {
          property[field] = parseFloat(req.body[field]);
        } else if (
          field === "furnished" ||
          field === "petsAllowed" ||
          field === "active" ||
          field === "soldOut"
        ) {
          property[field] =
            req.body[field] === true || req.body[field] === "true";
        } else if (field === "availableFrom") {
          property[field] = new Date(req.body[field]);
        } else if (
          field === "address" ||
          field === "nearbyPlaces" ||
          field === "projectUrl"
        ) {
          property[field] =
            req.body[field] != null ? String(req.body[field]).trim() : "";
        } else if (field === "nearbyUniversities") {
          const arr = req.body[field];
          property[field] = Array.isArray(arr)
            ? arr
                .filter((u) => u && u.name && typeof u.miles === "number")
                .map((u) => ({
                  name: String(u.name).trim(),
                  miles: Number(u.miles),
                }))
            : [];
        } else if (field === "photos") {
          // Normalize and validate photos
          const photos = req.body[field];
          const normalizedPhotos = Array.isArray(photos)
            ? photos
                .map((photo) => {
                  if (typeof photo === "string") {
                    return {
                      url: photo,
                      isThumbnail: false,
                      category: "",
                    };
                  }
                  if (photo && typeof photo === "object") {
                    return {
                      url: photo.url || "",
                      isThumbnail: photo.isThumbnail || false,
                      category: photo.category || "",
                    };
                  }
                  return null;
                })
                .filter(Boolean)
            : [];

          // Validate that if photos exist, at least one must be a thumbnail
          if (normalizedPhotos.length > 0) {
            const hasThumbnail = normalizedPhotos.some(
              (photo) => photo.isThumbnail === true,
            );
            if (!hasThumbnail) {
              return res.status(400).json({
                message: "At least one photo must be set as thumbnail",
              });
            }
          }

          property[field] = normalizedPhotos;
        } else {
          property[field] = req.body[field];
        }
      }
    });

    await property.save();

    res.json({
      message: "Property updated successfully",
      property,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// DELETE /api/properties/:id - Delete property (owner only)
router.delete("/:id", authenticate, isCustomerOrAgency, async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);

    if (!property) {
      return res.status(404).json({ message: "Property not found" });
    }

    // Check ownership
    // Handle populated owner (from pre-find hook) or unpopulated ObjectId
    const propertyOwnerId = (property.owner?._id || property.owner).toString();
    const ownerId = req.userType === "AGENCY" ? req.agency._id : req.user._id;
    const expectedOwnerType = req.userType === "AGENCY" ? "Agency" : "User";

    if (
      propertyOwnerId !== ownerId.toString() ||
      property.ownerType !== expectedOwnerType
    ) {
      return res.status(403).json({ message: "Not authorized" });
    }

    await Property.findByIdAndDelete(req.params.id);

    res.json({
      message: "Property deleted successfully",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/properties/:id/requirements - Submit requirements for sold out property
router.post("/:id/requirements", async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);

    if (!property) {
      return res.status(404).json({ message: "Property not found" });
    }

    if (!property.soldOut) {
      return res.status(400).json({
        message:
          "This property is not sold out. Please use the interest form instead.",
      });
    }

    const { name, email, phone, message, requirements } = req.body;

    if (!name || !email || !phone || !message) {
      return res.status(400).json({
        message: "Name, email, phone, and message are required",
      });
    }

    const propertyRequirement = await PropertyRequirement.create({
      property: property._id,
      name,
      email,
      phone,
      message,
      requirements: requirements || "",
    });

    res.status(201).json({
      message: "Requirements submitted successfully",
      requirement: propertyRequirement,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/properties/:id/subscribe-featured - Subscribe to make property featured
router.post(
  "/:id/subscribe-featured",
  authenticate,
  isCustomerOrAgency,
  async (req, res) => {
    try {
      const property = await Property.findById(req.params.id);

      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      // Check ownership
      const propertyOwnerId = (
        property.owner?._id || property.owner
      ).toString();
      const ownerId = req.userType === "AGENCY" ? req.agency._id : req.user._id;
      const expectedOwnerType = req.userType === "AGENCY" ? "Agency" : "User";

      if (
        propertyOwnerId !== ownerId.toString() ||
        property.ownerType !== expectedOwnerType
      ) {
        return res.status(403).json({
          message: "Not authorized. You can only feature your own properties.",
        });
      }

      const { durationDays = 30, paymentIntentId } = req.body;

      // Validate duration (1-365 days)
      const days = parseInt(durationDays);
      if (isNaN(days) || days < 1 || days > 365) {
        return res.status(400).json({
          message: "Duration must be between 1 and 365 days",
        });
      }

      // Calculate expiry date
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + days);

      // If property is already featured and hasn't expired, extend the date
      if (property.featured && property.featuredUntil) {
        const currentExpiry = new Date(property.featuredUntil);
        const now = new Date();
        if (currentExpiry > now) {
          // Extend from current expiry date
          expiryDate.setTime(
            currentExpiry.getTime() + days * 24 * 60 * 60 * 1000,
          );
        }
      }

      // Update property to featured
      property.featured = true;
      property.featuredUntil = expiryDate;

      await property.save();

      res.json({
        message: "Property featured successfully",
        property: {
          _id: property._id,
          featured: property.featured,
          featuredUntil: property.featuredUntil,
        },
        expiresAt: expiryDate,
        durationDays: days,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },
);

export default router;

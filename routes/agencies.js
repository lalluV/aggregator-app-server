import express from "express";
import Agency from "../models/Agency.js";
import AgencyInquiry from "../models/AgencyInquiry.js";
import { authenticate, isAgency, isAdmin } from "../middleware/auth.js";

const router = express.Router();

// GET /api/agencies - List all agencies
router.get("/", async (req, res) => {
  try {
    const { category, city, country, limit, q } = req.query;

    let query = { isApproved: true, isActive: { $ne: false } };

    if (category) {
      query.category = category;
    }
    if (city) {
      query.city = new RegExp(city, "i");
    }
    if (country) {
      // Filter by country name (case-insensitive)
      query.country = new RegExp(`^${country}$`, "i");
    }
    if (q && String(q).trim()) {
      const escaped = String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const term = new RegExp(escaped, "i");
      query.$or = [{ name: term }, { city: term }];
    }

    let agenciesQuery = Agency.find(query)
      .select("-passwordHash")
      .sort({ createdAt: -1 });

    if (limit) {
      agenciesQuery = agenciesQuery.limit(parseInt(limit));
    }

    const results = await agenciesQuery;

    res.json({
      count: results.length,
      agencies: results,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/agencies/available-categories - Get available categories for a country
// Must be before /:id route to avoid route conflict
router.get("/available-categories", async (req, res) => {
  try {
    const { country } = req.query;

    if (!country) {
      return res.status(400).json({
        message: "Country parameter is required",
      });
    }

    // Find all approved agencies in the specified country
    const agencies = await Agency.find({
      isApproved: true,
      isActive: { $ne: false },
      country: new RegExp(`^${country}$`, "i"),
    }).select("category");

    // Extract all unique categories from agencies
    const categorySet = new Set();
    agencies.forEach((agency) => {
      if (agency.category && Array.isArray(agency.category)) {
        agency.category.forEach((cat) => {
          if (cat) {
            categorySet.add(cat);
          }
        });
      }
    });

    const availableCategories = Array.from(categorySet).sort();

    res.json({
      country,
      categories: availableCategories,
      count: availableCategories.length,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/agencies/inquiries - Get own inquiries (Agency only)
// Must be before /:id route to avoid route conflict
router.get("/inquiries", authenticate, isAgency, async (req, res) => {
  try {
    const inquiries = await AgencyInquiry.find({ agency: req.agency._id }).sort(
      { createdAt: -1 }
    );

    res.json({
      count: inquiries.length,
      inquiries,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PATCH /api/agencies/profile - Update own profile
// Must be before /:id route to avoid route conflict
router.patch("/profile", authenticate, isAgency, async (req, res) => {
  try {
    const {
      name,
      about,
      phone,
      website,
      address,
      city,
      country,
      logoUrl,
      images,
      category,
      businessHours,
      languages,
      socialMedia,
      yearsInBusiness,
      certifications,
      serviceAreas,
    } = req.body;

    const updateData = {};
    if (name) updateData.name = name;
    if (about !== undefined) updateData.about = about;
    if (phone) updateData.phone = phone;
    if (website !== undefined) updateData.website = website;
    if (address !== undefined) updateData.address = address;
    if (city) updateData.city = city;
    if (country) updateData.country = country;
    if (logoUrl !== undefined) updateData.logoUrl = logoUrl;
    if (images !== undefined) {
      // Normalize images: convert strings to objects, ensure objects have required fields
      const normalizedImages = Array.isArray(images)
        ? images
            .map((img) => {
              if (typeof img === "string") {
                // Convert legacy string format to object
                return {
                  url: img,
                  isThumbnail: false,
                  category: "",
                };
              }
              // Ensure object has required fields
              if (img && typeof img === "object") {
                return {
                  url: img.url || "",
                  isThumbnail: img.isThumbnail || false,
                  category: img.category || "",
                };
              }
              return null;
            })
            .filter(Boolean) // Remove any null values
        : [];
      updateData.images = normalizedImages;
    }
    if (category)
      updateData.category = Array.isArray(category) ? category : [category];
    if (businessHours !== undefined) updateData.businessHours = businessHours;
    if (languages !== undefined)
      updateData.languages = Array.isArray(languages) ? languages : [];
    if (socialMedia !== undefined) updateData.socialMedia = socialMedia;
    if (yearsInBusiness !== undefined)
      updateData.yearsInBusiness = parseInt(yearsInBusiness) || 0;
    if (certifications !== undefined)
      updateData.certifications = Array.isArray(certifications)
        ? certifications
        : [];
    if (serviceAreas !== undefined)
      updateData.serviceAreas = Array.isArray(serviceAreas) ? serviceAreas : [];

    const agency = await Agency.findByIdAndUpdate(req.agency._id, updateData, {
      new: true,
    }).select("-passwordHash");

    res.json({
      message: "Profile updated successfully",
      agency,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/agencies/:id - Agency detail
router.get("/:id", async (req, res) => {
  try {
    const agency = await Agency.findById(req.params.id).select("-passwordHash");

    if (!agency) {
      return res.status(404).json({ message: "Agency not found" });
    }

    if (!agency.isApproved || agency.isActive === false) {
      return res.status(404).json({ message: "Agency not found" });
    }

    // Get statistics
    const inquiryCount = await AgencyInquiry.countDocuments({
      agency: req.params.id,
    });

    // Calculate years in business from createdAt
    const yearsInBusiness =
      agency.yearsInBusiness ||
      Math.floor(
        (Date.now() - new Date(agency.createdAt).getTime()) /
          (1000 * 60 * 60 * 24 * 365)
      );

    res.json({
      agency: {
        ...agency.toObject(),
        stats: {
          inquiryCount,
          yearsInBusiness,
          memberSince: agency.createdAt,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/agencies/:id/contact - Contact agency
router.post("/:id/contact", async (req, res) => {
  try {
    const { name, phone, email, message } = req.body;

    if (!name || !phone || !email) {
      return res
        .status(400)
        .json({ message: "Name, phone, and email are required" });
    }

    const agency = await Agency.findById(req.params.id);
    if (!agency) {
      return res.status(404).json({ message: "Agency not found" });
    }
    if (!agency.isApproved || agency.isActive === false) {
      return res.status(404).json({ message: "Agency not found" });
    }

    const inquiry = await AgencyInquiry.create({
      agency: req.params.id,
      name,
      phone,
      email,
      message: message || "",
    });

    res.status(201).json({
      message: "Inquiry sent successfully",
      inquiry,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// DELETE /api/agencies/:id - Delete agency (Admin only)
router.delete("/:id", authenticate, isAdmin, async (req, res) => {
  try {
    const agency = await Agency.findByIdAndDelete(req.params.id);

    if (!agency) {
      return res.status(404).json({ message: "Agency not found" });
    }

    res.json({ message: "Agency deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;

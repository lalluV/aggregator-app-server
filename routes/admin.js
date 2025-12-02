import express from "express";
import bcrypt from "bcrypt";
import User from "../models/User.js";
import Agency from "../models/Agency.js";
import Property from "../models/Property.js";
import Interest from "../models/Interest.js";
import AgencyInquiry from "../models/AgencyInquiry.js";
import Country from "../models/Country.js";
import { authenticate, isAdmin } from "../middleware/auth.js";

const router = express.Router();

// POST /api/admin/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    // Find admin user
    const user = await User.findOne({ email, role: "ADMIN" });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Return user data (no tokens, no cookies)
    res.json({
      message: "Login successful",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/admin/dashboard - Dashboard summary
router.get("/dashboard", authenticate, isAdmin, async (req, res) => {
  try {
    const [
      usersCount,
      agenciesCount,
      propertiesCount,
      interestsCount,
      inquiriesCount,
      featuredPropertiesCount,
      activePropertiesCount,
      totalViews,
      propertyTypes,
    ] = await Promise.all([
      User.countDocuments({ role: "CUSTOMER" }),
      Agency.countDocuments(),
      Property.countDocuments(),
      Interest.countDocuments(),
      AgencyInquiry.countDocuments(),
      Property.countDocuments({ featured: true }),
      Property.countDocuments({ active: true }),
      Property.aggregate([
        { $group: { _id: null, total: { $sum: "$views" } } },
      ]),
      Property.aggregate([
        { $group: { _id: "$propertyType", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    res.json({
      summary: {
        users: usersCount,
        agencies: agenciesCount,
        properties: propertiesCount,
        interests: interestsCount,
        inquiries: inquiriesCount,
        featuredProperties: featuredPropertiesCount,
        activeProperties: activePropertiesCount,
        totalViews: totalViews[0]?.total || 0,
        propertyTypes: propertyTypes,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/admin/users - List all users
router.get("/users", authenticate, isAdmin, async (req, res) => {
  try {
    const users = await User.find({ role: "CUSTOMER" })
      .select("-passwordHash")
      .sort({ createdAt: -1 });
    res.json({ count: users.length, users });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/admin/agencies - List all agencies
router.get("/agencies", authenticate, isAdmin, async (req, res) => {
  try {
    const agencies = await Agency.find()
      .select("-passwordHash")
      .sort({ createdAt: -1 });
    res.json({ count: agencies.length, agencies });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PATCH /api/admin/agencies/:id/approve - Approve agency
router.patch(
  "/agencies/:id/approve",
  authenticate,
  isAdmin,
  async (req, res) => {
    try {
      const agency = await Agency.findByIdAndUpdate(
        req.params.id,
        { isApproved: true },
        { new: true }
      ).select("-passwordHash");

      if (!agency) {
        return res.status(404).json({ message: "Agency not found" });
      }

      res.json({ message: "Agency approved", agency });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// DELETE /api/admin/agencies/:id - Delete agency
router.delete("/agencies/:id", authenticate, isAdmin, async (req, res) => {
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

// GET /api/admin/properties - List all properties
router.get("/properties", authenticate, isAdmin, async (req, res) => {
  try {
    const properties = await Property.find().sort({ createdAt: -1 });
    res.json({ count: properties.length, properties });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PATCH /api/admin/properties/:id/feature - Feature/unfeature property
router.patch(
  "/properties/:id/feature",
  authenticate,
  isAdmin,
  async (req, res) => {
    try {
      const { featured } = req.body;
      const property = await Property.findByIdAndUpdate(
        req.params.id,
        { featured: featured === true || featured === "true" },
        { new: true }
      );

      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      res.json({
        message: property.featured
          ? "Property featured successfully"
          : "Property unfeatured successfully",
        property,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// DELETE /api/admin/properties/:id - Delete property
router.delete("/properties/:id", authenticate, isAdmin, async (req, res) => {
  try {
    const property = await Property.findByIdAndDelete(req.params.id);
    if (!property) {
      return res.status(404).json({ message: "Property not found" });
    }
    res.json({ message: "Property deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/admin/interests - List all interests
router.get("/interests", authenticate, isAdmin, async (req, res) => {
  try {
    const interests = await Interest.find()
      .populate("property", "title city")
      .sort({ createdAt: -1 });
    res.json({ count: interests.length, interests });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/admin/inquiries - List all agency inquiries
router.get("/inquiries", authenticate, isAdmin, async (req, res) => {
  try {
    const inquiries = await AgencyInquiry.find()
      .populate("agency", "name category")
      .sort({ createdAt: -1 });
    res.json({ count: inquiries.length, inquiries });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/admin/countries - List all countries
router.get("/countries", authenticate, isAdmin, async (req, res) => {
  try {
    const countries = await Country.find().sort({ name: 1 });
    res.json({ count: countries.length, countries });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/admin/countries - Create country
router.post("/countries", authenticate, isAdmin, async (req, res) => {
  try {
    const { name, currency } = req.body;

    if (!name || !currency) {
      return res
        .status(400)
        .json({ message: "Name and currency are required" });
    }

    const country = await Country.create({
      name: name.trim(),
      currency: currency.trim().toUpperCase(),
    });

    res.status(201).json({
      message: "Country created successfully",
      country,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: "Country already exists" });
    }
    res.status(500).json({ message: error.message });
  }
});

// DELETE /api/admin/countries/:id - Delete country
router.delete("/countries/:id", authenticate, isAdmin, async (req, res) => {
  try {
    const countryId = req.params.id;

    // Check if country is used by any properties or agencies
    const [propertiesCount, agenciesCount] = await Promise.all([
      Property.countDocuments({ country: countryId }),
      Agency.countDocuments({ country: countryId }),
    ]);

    if (propertiesCount > 0 || agenciesCount > 0) {
      return res.status(400).json({
        message: `Cannot delete country. It is used by ${propertiesCount} properties and ${agenciesCount} agencies.`,
      });
    }

    const country = await Country.findByIdAndDelete(countryId);
    if (!country) {
      return res.status(404).json({ message: "Country not found" });
    }

    res.json({ message: "Country deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;

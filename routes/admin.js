import express from "express";
import bcrypt from "bcrypt";
import User from "../models/User.js";
import Agency from "../models/Agency.js";
import Property from "../models/Property.js";
import Interest from "../models/Interest.js";
import AgencyInquiry from "../models/AgencyInquiry.js";
import PropertyRequirement from "../models/PropertyRequirement.js";
import Country from "../models/Country.js";
import PartnerSubmission from "../models/PartnerSubmission.js";
import { authenticate, isAdmin } from "../middleware/auth.js";
import { cleanupExpiredFeatured } from "../utils/featuredCleanup.js";

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
      const { featured, featuredUntil } = req.body;
      const updateData = {
        featured: featured === true || featured === "true",
      };
      
      // If featuring, set expiry date (default 30 days if not provided)
      if (updateData.featured && featuredUntil) {
        updateData.featuredUntil = new Date(featuredUntil);
      } else if (updateData.featured && !featuredUntil) {
        // Default to 30 days from now
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 30);
        updateData.featuredUntil = expiryDate;
      } else if (!updateData.featured) {
        // If unfeaturing, clear the expiry date
        updateData.featuredUntil = null;
      }
      
      const property = await Property.findByIdAndUpdate(
        req.params.id,
        updateData,
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

// PATCH /api/admin/properties/:id/soldout - Toggle sold out status
router.patch(
  "/properties/:id/soldout",
  authenticate,
  isAdmin,
  async (req, res) => {
    try {
      const { soldOut } = req.body;
      const property = await Property.findByIdAndUpdate(
        req.params.id,
        { soldOut: soldOut === true || soldOut === "true" },
        { new: true }
      );

      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      res.json({
        message: property.soldOut
          ? "Property marked as sold out"
          : "Property marked as available",
        property,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// GET /api/admin/properties/:id - Get property (Admin)
router.get("/properties/:id", authenticate, isAdmin, async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);
    if (!property) {
      return res.status(404).json({ message: "Property not found" });
    }
    res.json({ property });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PATCH /api/admin/properties/:id - Update property (Admin)
router.patch("/properties/:id", authenticate, isAdmin, async (req, res) => {
  try {
    const property = await Property.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    if (!property) {
      return res.status(404).json({ message: "Property not found" });
    }

    res.json({
      message: "Property updated successfully",
      property,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

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

// POST /api/admin/properties - Create property (Admin)
router.post("/properties", authenticate, isAdmin, async (req, res) => {
  try {
    const propertyData = req.body;
    
    // Set owner to admin user if not provided
    if (!propertyData.owner) {
      propertyData.owner = req.user._id;
      propertyData.ownerType = "User";
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

// POST /api/admin/agencies - Create agency (Admin)
router.post("/agencies", authenticate, isAdmin, async (req, res) => {
  try {
    const { name, email, password, ...agencyData } = req.body;
    
    if (!name || !email || !password) {
      return res.status(400).json({
        message: "Name, email, and password are required",
      });
    }
    
    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    
    const agency = await Agency.create({
      name,
      email,
      passwordHash,
      isApproved: true, // Auto-approve admin-created agencies
      ...agencyData,
    });
    
    res.status(201).json({
      message: "Agency created successfully",
      agency: await Agency.findById(agency._id).select("-passwordHash"),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: "Email already exists" });
    }
    res.status(500).json({ message: error.message });
  }
});

// GET /api/admin/users/:id - Get user profile
router.get("/users/:id", authenticate, isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-passwordHash");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({ user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PATCH /api/admin/users/:id - Update user profile
router.patch("/users/:id", authenticate, isAdmin, async (req, res) => {
  try {
    const { password, ...updateData } = req.body;
    
    if (password) {
      const saltRounds = 10;
      updateData.passwordHash = await bcrypt.hash(password, saltRounds);
    }
    
    const user = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).select("-passwordHash");
    
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    
    res.json({
      message: "User updated successfully",
      user,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/admin/agencies/:id - Get agency profile
router.get("/agencies/:id", authenticate, isAdmin, async (req, res) => {
  try {
    const agency = await Agency.findById(req.params.id).select("-passwordHash");
    if (!agency) {
      return res.status(404).json({ message: "Agency not found" });
    }
    res.json({ agency });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PATCH /api/admin/agencies/:id - Update agency profile
router.patch("/agencies/:id", authenticate, isAdmin, async (req, res) => {
  try {
    const { password, ...updateData } = req.body;
    
    if (password) {
      const saltRounds = 10;
      updateData.passwordHash = await bcrypt.hash(password, saltRounds);
    }
    
    const agency = await Agency.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).select("-passwordHash");
    
    if (!agency) {
      return res.status(404).json({ message: "Agency not found" });
    }
    
    res.json({
      message: "Agency updated successfully",
      agency,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/admin/partners - Get partner submissions
router.get("/partners", authenticate, isAdmin, async (req, res) => {
  try {
    const submissions = await PartnerSubmission.find()
      .sort({ createdAt: -1 });
    res.json({ count: submissions.length, submissions });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PATCH /api/admin/partners/:id/status - Update partner submission status
router.patch("/partners/:id/status", authenticate, isAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const submission = await PartnerSubmission.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    
    if (!submission) {
      return res.status(404).json({ message: "Submission not found" });
    }
    
    res.json({
      message: "Status updated successfully",
      submission,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/admin/requirements - List all property requirements
router.get("/requirements", authenticate, isAdmin, async (req, res) => {
  try {
    const requirements = await PropertyRequirement.find()
      .populate("property", "title city country price")
      .sort({ createdAt: -1 });
    res.json({ count: requirements.length, requirements });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PATCH /api/admin/requirements/:id/status - Update requirement status
router.patch(
  "/requirements/:id/status",
  authenticate,
  isAdmin,
  async (req, res) => {
    try {
      const { status } = req.body;
      const requirement = await PropertyRequirement.findByIdAndUpdate(
        req.params.id,
        { status },
        { new: true }
      ).populate("property", "title city country price");

      if (!requirement) {
        return res.status(404).json({ message: "Requirement not found" });
      }

      res.json({
        message: "Requirement status updated successfully",
        requirement,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// POST /api/admin/cleanup-expired-featured - Manually trigger cleanup of expired featured properties
router.post(
  "/cleanup-expired-featured",
  authenticate,
  isAdmin,
  async (req, res) => {
    try {
      const result = await cleanupExpiredFeatured();
      res.json({
        message: `Cleanup completed. ${result.updated} properties updated.`,
        ...result,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

export default router;

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
import UniversityApplication from "../models/UniversityApplication.js";
import LeadAssignment from "../models/LeadAssignment.js";
import AppSettings, { getFeaturedPlansFromDb } from "../models/AppSettings.js";
import { authenticate, isAdmin } from "../middleware/auth.js";
import { cleanupExpiredFeatured } from "../utils/featuredCleanup.js";
import {
  parsePagination,
  shouldSkipStats,
  escapeRegex,
} from "../utils/adminPagination.js";
import {
  buildUtcDateKeys,
  mergeDailyAggregation,
  aggregateDailyCreatedCounts,
} from "../utils/dashboardAnalytics.js";

const router = express.Router();

const DASHBOARD_TREND_DAYS = 30;

async function propertyObjectIdsForCountry(countryName) {
  if (!countryName || !String(countryName).trim()) return null;
  const escaped = escapeRegex(String(countryName).trim());
  const docs = await Property.find({
    country: new RegExp(`^${escaped}$`, "i"),
  })
    .select("_id")
    .lean();
  return docs.map((d) => d._id);
}

async function agencyObjectIdsForCountry(countryName) {
  if (!countryName || !String(countryName).trim()) return null;
  const escaped = escapeRegex(String(countryName).trim());
  const docs = await Agency.find({
    country: new RegExp(`^${escaped}$`, "i"),
  })
    .select("_id")
    .lean();
  return docs.map((d) => d._id);
}

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

// GET /api/admin/dashboard - Summary + 30-day creation trends + top countries
router.get("/dashboard", authenticate, isAdmin, async (req, res) => {
  try {
    const trendDays = DASHBOARD_TREND_DAYS;
    const dateKeys = buildUtcDateKeys(trendDays);

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
      requirementsCount,
      partnersTotal,
      partnersPending,
      universityLeadsCount,
      leadAssignmentsCount,
      countriesCount,
      agenciesPendingApproval,
      propDailyRaw,
      userDailyRaw,
      interestDailyRaw,
      inquiryDailyRaw,
      topCountries,
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
      PropertyRequirement.countDocuments(),
      PartnerSubmission.countDocuments(),
      PartnerSubmission.countDocuments({ status: "pending" }),
      UniversityApplication.countDocuments(),
      LeadAssignment.countDocuments(),
      Country.countDocuments(),
      Agency.countDocuments({ isApproved: false }),
      aggregateDailyCreatedCounts(Property, {}, trendDays),
      aggregateDailyCreatedCounts(User, { role: "CUSTOMER" }, trendDays),
      aggregateDailyCreatedCounts(Interest, {}, trendDays),
      aggregateDailyCreatedCounts(AgencyInquiry, {}, trendDays),
      Property.aggregate([
        { $match: { country: { $exists: true, $nin: [null, ""] } } },
        { $group: { _id: "$country", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
    ]);

    const trends = {
      days: trendDays,
      properties: mergeDailyAggregation(propDailyRaw, dateKeys),
      users: mergeDailyAggregation(userDailyRaw, dateKeys),
      interests: mergeDailyAggregation(interestDailyRaw, dateKeys),
      inquiries: mergeDailyAggregation(inquiryDailyRaw, dateKeys),
    };

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
        propertyTypes,
        requirements: requirementsCount,
        partnersTotal,
        partnersPending,
        universityLeads: universityLeadsCount,
        leadAssignments: leadAssignmentsCount,
        countries: countriesCount,
        agenciesPendingApproval,
        topCountries: topCountries.map((c) => ({
          country: c._id,
          count: c.count,
        })),
      },
      trends,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/admin/users - List users (paginated)
router.get("/users", authenticate, isAdmin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req);
    const filter = { role: "CUSTOMER" };
    const q =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    if (q) {
      const safe = escapeRegex(q);
      filter.$or = [
        { name: { $regex: safe, $options: "i" } },
        { email: { $regex: safe, $options: "i" } },
        { phone: { $regex: safe, $options: "i" } },
      ];
    }
    const skipStats = shouldSkipStats(req);
    const queries = [
      User.countDocuments(filter),
      User.find(filter)
        .select("-passwordHash")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
    ];
    if (!skipStats) {
      queries.push(User.countDocuments({ role: "CUSTOMER" }));
    }
    const results = await Promise.all(queries);
    const total = results[0];
    const users = results[1];
    res.json({
      users,
      total,
      page,
      limit,
      hasMore: skip + users.length < total,
      ...(!skipStats && results[2] !== undefined
        ? { stats: { total: results[2] } }
        : {}),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/admin/agencies - List agencies (paginated; ?country= ?search= ?isApproved= ?active=)
router.get("/agencies", authenticate, isAdmin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req);
    const filter = {};
    const country = req.query.country;
    if (country && String(country).trim()) {
      const escaped = escapeRegex(String(country).trim());
      filter.country = new RegExp(`^${escaped}$`, "i");
    }
    if (req.query.isApproved !== undefined && req.query.isApproved !== "") {
      filter.isApproved = req.query.isApproved === "true";
    }
    if (req.query.active !== undefined && req.query.active !== "") {
      if (req.query.active === "true") {
        filter.isActive = { $ne: false };
      } else if (req.query.active === "false") {
        filter.isActive = false;
      }
    }
    const q =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    if (q) {
      const safe = escapeRegex(q);
      filter.$or = [
        { name: { $regex: safe, $options: "i" } },
        { email: { $regex: safe, $options: "i" } },
        { city: { $regex: safe, $options: "i" } },
        { country: { $regex: safe, $options: "i" } },
      ];
    }
    const skipStats = shouldSkipStats(req);
    const queries = [
      Agency.countDocuments(filter),
      Agency.find(filter)
        .select("-passwordHash")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
    ];
    if (!skipStats) {
      queries.push(
        Agency.countDocuments({}),
        Agency.countDocuments({ isApproved: true }),
        Agency.countDocuments({ isApproved: false }),
        Agency.countDocuments({ isActive: { $ne: false } }),
        Agency.countDocuments({ isActive: false }),
      );
    }
    const results = await Promise.all(queries);
    const total = results[0];
    const agencies = results[1];
    res.json({
      agencies,
      total,
      page,
      limit,
      hasMore: skip + agencies.length < total,
      ...(!skipStats && results[2] !== undefined
        ? {
            stats: {
              total: results[2],
              approved: results[3],
              pending: results[4],
              activeAccounts: results[5],
              inactiveAccounts: results[6],
            },
          }
        : {}),
    });
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
        { new: true },
      ).select("-passwordHash");

      if (!agency) {
        return res.status(404).json({ message: "Agency not found" });
      }

      res.json({ message: "Agency approved", agency });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },
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

// GET /api/admin/properties - List properties (paginated + optional filters)
router.get("/properties", authenticate, isAdmin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req, {
      defaultLimit: 25,
      maxLimit: 500,
    });

    const filter = {};
    if (req.query.propertyType) {
      filter.propertyType = req.query.propertyType;
    }
    if (req.query.featured !== undefined && req.query.featured !== "") {
      filter.featured = req.query.featured === "true";
    }
    if (req.query.active !== undefined && req.query.active !== "") {
      filter.active = req.query.active === "true";
    }
    const q =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    if (q) {
      const safe = escapeRegex(q);
      filter.$or = [
        { title: { $regex: safe, $options: "i" } },
        { description: { $regex: safe, $options: "i" } },
      ];
    }

    const skipStats = shouldSkipStats(req);

    const findQuery = Property.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({ path: "owner", select: "name email" });

    const queries = [Property.countDocuments(filter), findQuery.exec()];
    if (!skipStats) {
      queries.push(
        Property.countDocuments({}),
        Property.countDocuments({ active: true }),
        Property.countDocuments({ featured: true }),
      );
    }

    const results = await Promise.all(queries);
    const total = results[0];
    const properties = results[1];
    let stats = null;
    if (!skipStats) {
      stats = {
        total: results[2],
        active: results[3],
        featured: results[4],
      };
    }

    res.json({
      properties,
      total,
      page,
      limit,
      hasMore: skip + properties.length < total,
      ...(stats ? { stats } : {}),
    });
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
        { new: true },
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
  },
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
        { new: true },
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
  },
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
    const property = await Property.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });

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

// GET /api/admin/interests - List interests (paginated; ?country= ?search=)
router.get("/interests", authenticate, isAdmin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req);
    const filter = {};
    const country = req.query.country;
    if (country && String(country).trim()) {
      const propIds = await propertyObjectIdsForCountry(country);
      filter.property = propIds?.length ? { $in: propIds } : { $in: [] };
    }
    const q =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    if (q) {
      const safe = escapeRegex(q);
      const propIds = await Property.find({
        $or: [
          { title: { $regex: safe, $options: "i" } },
          { city: { $regex: safe, $options: "i" } },
        ],
      }).distinct("_id");
      filter.$or = [
        { name: { $regex: safe, $options: "i" } },
        { email: { $regex: safe, $options: "i" } },
        { phone: { $regex: safe, $options: "i" } },
        { message: { $regex: safe, $options: "i" } },
        ...(propIds.length ? [{ property: { $in: propIds } }] : []),
      ];
    }
    const skipStats = shouldSkipStats(req);
    const queries = [
      Interest.countDocuments(filter),
      Interest.find(filter)
        .populate("property", "title city country")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
    ];
    if (!skipStats) {
      queries.push(Interest.countDocuments({}));
    }
    const results = await Promise.all(queries);
    const total = results[0];
    const interests = results[1];
    res.json({
      interests,
      total,
      page,
      limit,
      hasMore: skip + interests.length < total,
      ...(!skipStats && results[2] !== undefined
        ? { stats: { total: results[2] } }
        : {}),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/admin/inquiries - List inquiries (paginated; ?country= ?search=)
router.get("/inquiries", authenticate, isAdmin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req);
    const filter = {};
    const country = req.query.country;
    if (country && String(country).trim()) {
      const agencyIds = await agencyObjectIdsForCountry(country);
      filter.agency = agencyIds?.length ? { $in: agencyIds } : { $in: [] };
    }
    const q =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    if (q) {
      const safe = escapeRegex(q);
      const agencyIds = await Agency.find({
        $or: [
          { name: { $regex: safe, $options: "i" } },
          { city: { $regex: safe, $options: "i" } },
          { country: { $regex: safe, $options: "i" } },
        ],
      }).distinct("_id");
      filter.$or = [
        { name: { $regex: safe, $options: "i" } },
        { email: { $regex: safe, $options: "i" } },
        { phone: { $regex: safe, $options: "i" } },
        { message: { $regex: safe, $options: "i" } },
        ...(agencyIds.length ? [{ agency: { $in: agencyIds } }] : []),
      ];
    }
    const skipStats = shouldSkipStats(req);
    const queries = [
      AgencyInquiry.countDocuments(filter),
      AgencyInquiry.find(filter)
        .populate("agency", "name category city country")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
    ];
    if (!skipStats) {
      queries.push(AgencyInquiry.countDocuments({}));
    }
    const results = await Promise.all(queries);
    const total = results[0];
    const inquiries = results[1];
    res.json({
      inquiries,
      total,
      page,
      limit,
      hasMore: skip + inquiries.length < total,
      ...(!skipStats && results[2] !== undefined
        ? { stats: { total: results[2] } }
        : {}),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/admin/countries - List countries (paginated; ?search=)
router.get("/countries", authenticate, isAdmin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req);
    const filter = {};
    const q =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    if (q) {
      const safe = escapeRegex(q);
      filter.$or = [
        { name: { $regex: safe, $options: "i" } },
        { currency: { $regex: safe, $options: "i" } },
      ];
    }
    const skipStats = shouldSkipStats(req);
    const queries = [
      Country.countDocuments(filter),
      Country.find(filter).sort({ name: 1 }).skip(skip).limit(limit),
    ];
    if (!skipStats) {
      queries.push(Country.countDocuments({}));
    }
    const results = await Promise.all(queries);
    const total = results[0];
    const countries = results[1];
    res.json({
      countries,
      total,
      page,
      limit,
      hasMore: skip + countries.length < total,
      ...(!skipStats && results[2] !== undefined
        ? { stats: { total: results[2] } }
        : {}),
    });
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

    const user = await User.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
    }).select("-passwordHash");

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

    const agency = await Agency.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
    }).select("-passwordHash");

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

// GET /api/admin/university-applications - Leads (paginated; ?search= ?status= ?unassignedOnly=)
router.get(
  "/university-applications",
  authenticate,
  isAdmin,
  async (req, res) => {
    try {
      const { page, limit, skip } = parsePagination(req);
      const filter = {};
      if (
        req.query.status &&
        req.query.status !== "" &&
        req.query.status !== "all"
      ) {
        filter.status = req.query.status;
      }
      const q =
        typeof req.query.search === "string" ? req.query.search.trim() : "";
      if (q) {
        const safe = escapeRegex(q);
        filter.$or = [
          { name: { $regex: safe, $options: "i" } },
          { email: { $regex: safe, $options: "i" } },
          { phone: { $regex: safe, $options: "i" } },
          { country: { $regex: safe, $options: "i" } },
          { preferredCourses: { $regex: safe, $options: "i" } },
          { academicDetails: { $regex: safe, $options: "i" } },
        ];
      }
      if (
        req.query.unassignedOnly === "1" ||
        req.query.unassignedOnly === "true"
      ) {
        const assignedIds = await LeadAssignment.distinct(
          "universityApplicationId",
        );
        const oidList = (assignedIds || []).filter(Boolean);
        filter._id = oidList.length ? { $nin: oidList } : { $exists: true };
      }
      const skipStats = shouldSkipStats(req);
      const queries = [
        UniversityApplication.countDocuments(filter),
        UniversityApplication.find(filter)
          .sort({ createdAt: -1 })
          .select("-__v")
          .skip(skip)
          .limit(limit),
      ];
      if (!skipStats) {
        queries.push(UniversityApplication.countDocuments({}));
      }
      const results = await Promise.all(queries);
      const total = results[0];
      const leads = results[1];
      res.json({
        leads,
        total,
        page,
        limit,
        hasMore: skip + leads.length < total,
        ...(!skipStats && results[2] !== undefined
          ? { stats: { total: results[2] } }
          : {}),
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },
);

// PATCH /api/admin/university-applications/:id/status - Update lead status
router.patch(
  "/university-applications/:id/status",
  authenticate,
  isAdmin,
  async (req, res) => {
    try {
      const { status } = req.body;
      const validStatuses = [
        "pending",
        "contacted",
        "processing",
        "submitted",
        "rejected",
      ];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          message:
            "Invalid status. Must be one of: " + validStatuses.join(", "),
        });
      }

      const lead = await UniversityApplication.findByIdAndUpdate(
        req.params.id,
        { status },
        { new: true },
      ).select("-__v");

      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }

      res.json({
        message: "Status updated successfully",
        lead,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },
);

// GET /api/admin/lead-assignments - Sent leads (paginated; ?status=)
router.get("/lead-assignments", authenticate, isAdmin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req);
    const { status } = req.query;
    const filter = {};
    const pipelineStatuses = ["new", "contacted", "converted", "closed"];
    if (
      status &&
      status !== "all" &&
      pipelineStatuses.includes(String(status))
    ) {
      filter.status = status;
    }

    const skipStats = shouldSkipStats(req);
    const findQ = LeadAssignment.find(filter)
      .populate("agencyId", "name email city country phone")
      .populate("universityApplicationId")
      .populate("assignedBy", "name email")
      .sort({ assignedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const queries = [LeadAssignment.countDocuments(filter), findQ];
    if (!skipStats) {
      queries.push(LeadAssignment.countDocuments({}));
    }
    const results = await Promise.all(queries);
    const total = results[0];
    const assignmentsRaw = results[1];
    const rows = assignmentsRaw.map((a) => ({
      _id: a._id,
      status: a.status,
      assignedAt: a.assignedAt,
      agency: a.agencyId,
      application: a.universityApplicationId,
      assignedBy: a.assignedBy,
    }));

    res.json({
      assignments: rows,
      total,
      page,
      limit,
      hasMore: skip + rows.length < total,
      ...(!skipStats && results[2] !== undefined
        ? { stats: { total: results[2] } }
        : {}),
    });
  } catch (error) {
    console.error("Error listing lead assignments:", error);
    res.status(500).json({ message: error.message });
  }
});

// POST /api/admin/university-applications/bulk-assign - Bulk assign leads to agency
router.post(
  "/university-applications/bulk-assign",
  authenticate,
  isAdmin,
  async (req, res) => {
    try {
      const { leadIds, agencyId } = req.body;

      if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
        return res
          .status(400)
          .json({ message: "Please select at least one lead" });
      }

      if (!agencyId) {
        return res.status(400).json({ message: "Please select an agency" });
      }

      const agency = await Agency.findById(agencyId);
      if (!agency) {
        return res.status(404).json({ message: "Agency not found" });
      }
      if (agency.isActive === false) {
        return res
          .status(400)
          .json({ message: "Cannot assign leads to an inactive agency" });
      }

      const assignments = [];
      const skipped = [];

      for (const leadId of leadIds) {
        const lead = await UniversityApplication.findById(leadId);
        if (!lead) {
          skipped.push({ leadId, reason: "Lead not found" });
          continue;
        }

        const existing = await LeadAssignment.findOne({
          agencyId,
          universityApplicationId: leadId,
        });
        if (existing) {
          skipped.push({ leadId, reason: "Already assigned to this agency" });
          continue;
        }

        const assignment = new LeadAssignment({
          agencyId,
          universityApplicationId: leadId,
          assignedBy: req.user.id,
        });
        await assignment.save();
        assignments.push(assignment);
      }

      res.json({
        message: `Successfully assigned ${assignments.length} lead(s) to ${agency.name}`,
        assigned: assignments.length,
        skipped: skipped.length,
        skippedDetails: skipped,
      });
    } catch (error) {
      console.error("Error bulk assigning leads:", error);
      res.status(500).json({ message: error.message });
    }
  },
);

// GET /api/admin/partners - Partner submissions (paginated; ?search= ?status=)
router.get("/partners", authenticate, isAdmin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req);
    const filter = {};
    if (req.query.status && req.query.status !== "all") {
      filter.status = req.query.status;
    }
    const q =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    if (q) {
      const safe = escapeRegex(q);
      filter.$or = [
        { organizationName: { $regex: safe, $options: "i" } },
        { contactName: { $regex: safe, $options: "i" } },
        { email: { $regex: safe, $options: "i" } },
        { phone: { $regex: safe, $options: "i" } },
        { city: { $regex: safe, $options: "i" } },
        { country: { $regex: safe, $options: "i" } },
      ];
    }
    const skipStats = shouldSkipStats(req);
    const queries = [
      PartnerSubmission.countDocuments(filter),
      PartnerSubmission.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
    ];
    if (!skipStats) {
      queries.push(
        PartnerSubmission.countDocuments({}),
        PartnerSubmission.countDocuments({ status: "pending" }),
        PartnerSubmission.countDocuments({ status: "contacted" }),
        PartnerSubmission.countDocuments({ status: "approved" }),
        PartnerSubmission.countDocuments({ status: "rejected" }),
      );
    }
    const results = await Promise.all(queries);
    const total = results[0];
    const submissions = results[1];
    res.json({
      submissions,
      total,
      page,
      limit,
      hasMore: skip + submissions.length < total,
      ...(!skipStats && results[2] !== undefined
        ? {
            stats: {
              total: results[2],
              pending: results[3],
              contacted: results[4],
              approved: results[5],
              rejected: results[6],
            },
          }
        : {}),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PATCH /api/admin/partners/:id/status - Update partner submission status
router.patch(
  "/partners/:id/status",
  authenticate,
  isAdmin,
  async (req, res) => {
    try {
      const { status } = req.body;
      const submission = await PartnerSubmission.findByIdAndUpdate(
        req.params.id,
        { status },
        { new: true },
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
  },
);

// GET /api/admin/requirements - List requirements (paginated; ?search= ?status= ?country=)
router.get("/requirements", authenticate, isAdmin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req);
    const filter = {};
    if (req.query.status && req.query.status !== "") {
      filter.status = req.query.status;
    }
    const country = req.query.country;
    if (country && String(country).trim()) {
      const propIds = await propertyObjectIdsForCountry(country);
      filter.property = propIds?.length ? { $in: propIds } : { $in: [] };
    }
    const q =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    if (q) {
      const safe = escapeRegex(q);
      const propIds = await Property.find({
        $or: [
          { title: { $regex: safe, $options: "i" } },
          { city: { $regex: safe, $options: "i" } },
        ],
      }).distinct("_id");
      filter.$or = [
        { name: { $regex: safe, $options: "i" } },
        { email: { $regex: safe, $options: "i" } },
        { phone: { $regex: safe, $options: "i" } },
        { message: { $regex: safe, $options: "i" } },
        ...(propIds.length ? [{ property: { $in: propIds } }] : []),
      ];
    }
    const skipStats = shouldSkipStats(req);
    const queries = [
      PropertyRequirement.countDocuments(filter),
      PropertyRequirement.find(filter)
        .populate("property", "title city country price")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
    ];
    if (!skipStats) {
      queries.push(
        PropertyRequirement.countDocuments({}),
        PropertyRequirement.countDocuments({ status: "pending" }),
        PropertyRequirement.countDocuments({ status: "contacted" }),
      );
    }
    const results = await Promise.all(queries);
    const total = results[0];
    const requirements = results[1];
    res.json({
      requirements,
      total,
      page,
      limit,
      hasMore: skip + requirements.length < total,
      ...(!skipStats && results[2] !== undefined
        ? {
            stats: {
              total: results[2],
              pending: results[3],
              contacted: results[4],
            },
          }
        : {}),
    });
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
        { new: true },
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
  },
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
  },
);

// GET /api/admin/featured-plans - Featured subscription tiers (Stripe amounts)
router.get("/featured-plans", authenticate, isAdmin, async (req, res) => {
  try {
    const plans = await getFeaturedPlansFromDb();
    res.json({ plans });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PATCH /api/admin/featured-plans - Update tiers { plans: [{ days, mrp, price }, ...] }
router.patch("/featured-plans", authenticate, isAdmin, async (req, res) => {
  try {
    const { plans } = req.body;
    if (!Array.isArray(plans) || plans.length === 0) {
      return res
        .status(400)
        .json({ message: "Body must include non-empty plans array" });
    }
    for (const p of plans) {
      const days = parseInt(p.days, 10);
      const price = Number(p.price);
      if (!days || days < 1 || Number.isNaN(price) || price < 0) {
        return res.status(400).json({
          message: "Each plan needs positive days and non-negative price",
        });
      }
    }
    const normalized = plans.map((p) => ({
      days: parseInt(p.days, 10),
      mrp: p.mrp
        ? Math.round(Number(p.mrp) * 100) / 100
        : Math.round(Number(p.price) * 100) / 100,
      price: Math.round(Number(p.price) * 100) / 100,
    }));
    await AppSettings.findOneAndUpdate(
      { _id: "app" },
      { $set: { featuredPlans: normalized } },
      { upsert: true, new: true },
    );
    const updated = await getFeaturedPlansFromDb();
    res.json({ message: "Featured plans updated", plans: updated });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;

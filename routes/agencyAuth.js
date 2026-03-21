import express from "express";
import bcrypt from "bcrypt";
import Agency from "../models/Agency.js";
import LeadAssignment from "../models/LeadAssignment.js";
import UniversityApplication from "../models/UniversityApplication.js";
import { authenticate, isAgency } from "../middleware/auth.js";

const router = express.Router();

// POST /api/agencies/register
router.post("/register", async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      category,
      about,
      phone,
      website,
      address,
      city,
      country,
    } = req.body;

    // Validation
    if (
      !name ||
      !email ||
      !password ||
      !category ||
      !phone ||
      !city ||
      !country
    ) {
      return res.status(400).json({
        message:
          "Required fields: name, email, password, category, phone, city, country",
      });
    }

    // Check if agency exists
    const existingAgency = await Agency.findOne({ email });
    if (existingAgency) {
      return res.status(400).json({ message: "Email already registered" });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create agency
    const agency = await Agency.create({
      name,
      email,
      passwordHash,
      category: Array.isArray(category) ? category : [category],
      about: about || "",
      phone,
      website: website || "",
      address: address || "",
      city,
      country,
      isApproved: false,
    });

    // Return agency data (no tokens, no cookies)
    res.status(201).json({
      message: "Agency registered successfully",
      agency: {
        id: agency._id,
        name: agency.name,
        email: agency.email,
        category: agency.category,
        phone: agency.phone,
        city: agency.city,
        country: agency.country,
        isApproved: agency.isApproved,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/agencies/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    // Find agency
    const agency = await Agency.findOne({ email });
    if (!agency) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, agency.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Return agency data (no tokens, no cookies)
    res.json({
      message: "Login successful",
      agency: {
        id: agency._id,
        name: agency.name,
        email: agency.email,
        category: agency.category,
        phone: agency.phone,
        city: agency.city,
        country: agency.country,
        isApproved: agency.isApproved,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

const ASSIGNMENT_STATUSES = ["new", "contacted", "converted", "closed"];

// GET /api/agencies/assigned-leads - Get leads assigned to this agency (?status=new|contacted|converted|closed|all)
router.get("/assigned-leads", authenticate, isAgency, async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { agencyId: req.agency._id };
    if (
      status &&
      status !== "all" &&
      ASSIGNMENT_STATUSES.includes(String(status))
    ) {
      filter.status = status;
    }

    const assignments = await LeadAssignment.find(filter)
      .populate("universityApplicationId")
      .sort({ assignedAt: -1 });

    const leads = assignments
      .map((a) => {
        const app = a.universityApplicationId;
        if (!app) return null;
        const appObj =
          typeof app.toObject === "function" ? app.toObject() : { ...app };
        return {
          assignmentId: a._id,
          assignedAt: a.assignedAt,
          assignmentStatus: a.status,
          ...appObj,
        };
      })
      .filter(Boolean);

    res.json({ count: leads.length, leads });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PATCH /api/agencies/assigned-leads/:assignmentId/status - Update pipeline status (agency only)
router.patch(
  "/assigned-leads/:assignmentId/status",
  authenticate,
  isAgency,
  async (req, res) => {
    try {
      const { status } = req.body;
      if (!status || !ASSIGNMENT_STATUSES.includes(status)) {
        return res.status(400).json({
          message: `status must be one of: ${ASSIGNMENT_STATUSES.join(", ")}`,
        });
      }

      const assignment = await LeadAssignment.findOne({
        _id: req.params.assignmentId,
        agencyId: req.agency._id,
      });

      if (!assignment) {
        return res.status(404).json({ message: "Assignment not found" });
      }

      assignment.status = status;
      await assignment.save();

      res.json({
        message: "Status updated",
        assignment: {
          assignmentId: assignment._id,
          assignmentStatus: assignment.status,
          assignedAt: assignment.assignedAt,
        },
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },
);

// GET /api/agencies/me
router.get("/me", authenticate, isAgency, async (req, res) => {
  try {
    res.json({
      agency: {
        id: req.agency._id,
        name: req.agency.name,
        email: req.agency.email,
        category: req.agency.category,
        about: req.agency.about,
        phone: req.agency.phone,
        website: req.agency.website,
        address: req.agency.address,
        city: req.agency.city,
        country: req.agency.country,
        logoUrl: req.agency.logoUrl,
        images: req.agency.images || [],
        isApproved: req.agency.isApproved,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/agencies/logout
router.post("/logout", (req, res) => {
  res.json({ message: "Logged out successfully" });
});

export default router;

import express from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import Agency from "../models/Agency.js";
import LeadAssignment from "../models/LeadAssignment.js";
import UniversityApplication from "../models/UniversityApplication.js";
import { authenticate, isAgency } from "../middleware/auth.js";
import { sendPasswordResetOtpEmail } from "../utils/emailjs.js";

const router = express.Router();
const RESET_OTP_TTL_MINUTES = Number(
  process.env.RESET_OTP_TTL_MINUTES ||
    process.env.RESET_PASSWORD_TTL_MINUTES ||
    15,
);
const DEFAULT_AGENCY_INFO_URL =
  process.env.AGENCY_RESET_PASSWORD_URL ||
  process.env.RESET_PASSWORD_WEB_URL ||
  "https://safeaven.com/auth/agency/forgot-password";

function generateSixDigitOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function normalizeOtpInput(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length === 6 ? digits : null;
}

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

    if (agency.isActive === false) {
      return res.status(403).json({
        message:
          "This account has been deactivated. Please contact support if you need access.",
      });
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
        isActive: agency.isActive !== false,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/agencies/forgot-password
router.post("/forgot-password", async (req, res) => {
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const agency = await Agency.findOne({ email });
    if (agency) {
      const otp = generateSixDigitOtp();
      const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
      const resetExpiresAt = new Date(
        Date.now() + RESET_OTP_TTL_MINUTES * 60 * 1000,
      );

      agency.resetPasswordTokenHash = otpHash;
      agency.resetPasswordExpiresAt = resetExpiresAt;
      await agency.save();

      try {
        await sendPasswordResetOtpEmail({
          toEmail: email,
          toName: agency.name,
          verificationCode: otp,
          infoUrl: DEFAULT_AGENCY_INFO_URL,
          expiresInMinutes: RESET_OTP_TTL_MINUTES,
          accountType: "agency",
        });
      } catch (emailError) {
        console.error(
          "Failed to send agency password reset email:",
          emailError.message,
        );
      }
    }

    return res.json({
      message:
        "If an account with that email exists, a verification code has been sent to your email.",
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// POST /api/agencies/reset-password — body: { email, code, password } (6-digit OTP only)
router.post("/reset-password", async (req, res) => {
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const otp = normalizeOtpInput(req.body?.code);
    const newPassword = String(req.body?.password || "");

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        message: "Email, 6-digit verification code, and password are required",
      });
    }

    if (newPassword.length < 6) {
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters" });
    }

    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");

    const agency = await Agency.findOne({
      email,
      resetPasswordTokenHash: otpHash,
      resetPasswordExpiresAt: { $gt: new Date() },
    });

    if (!agency) {
      return res.status(400).json({
        message: "Invalid or expired verification code",
      });
    }

    agency.passwordHash = await bcrypt.hash(newPassword, 10);
    agency.resetPasswordTokenHash = null;
    agency.resetPasswordExpiresAt = null;
    await agency.save();

    return res.json({ message: "Password reset successful" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
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
        isActive: req.agency.isActive !== false,
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

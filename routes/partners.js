import express from "express";
import PartnerSubmission from "../models/PartnerSubmission.js";
import { authenticate, isAdmin } from "../middleware/auth.js";

const router = express.Router();

// POST /api/partners/submit - Submit partner form
router.post("/submit", async (req, res) => {
  try {
    const {
      organizationName,
      organizationType,
      contactName,
      email,
      phone,
      country,
      city,
      message,
    } = req.body;

    // Validate required fields
    const requiredFields = {
      organizationName: "Organization name",
      organizationType: "Organization type",
      contactName: "Contact name",
      email: "Email",
      phone: "Phone",
      country: "Country",
      city: "City",
    };

    const missingFields = [];
    for (const [field, label] of Object.entries(requiredFields)) {
      if (
        !req.body[field] ||
        (typeof req.body[field] === "string" && !req.body[field].trim())
      ) {
        missingFields.push(label);
      }
    }

    if (missingFields.length > 0) {
      return res.status(400).json({
        message: `Please fill in all required fields: ${missingFields.join(
          ", "
        )}`,
      });
    }

    // Validate organization type
    if (!["university", "agency"].includes(organizationType)) {
      return res.status(400).json({
        message: "Invalid organization type. Must be 'university' or 'agency'",
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({
        message: "Please provide a valid email address",
      });
    }

    // Validate phone format (basic validation - allows international formats)
    const phoneRegex =
      /^[\+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,9}$/;
    const cleanedPhone = phone.replace(/\s/g, "");
    if (!phoneRegex.test(cleanedPhone) || cleanedPhone.length < 7) {
      return res.status(400).json({
        message: "Please provide a valid phone number",
      });
    }

    // Validate field lengths
    if (organizationName.trim().length < 2) {
      return res.status(400).json({
        message: "Organization name must be at least 2 characters",
      });
    }

    if (contactName.trim().length < 2) {
      return res.status(400).json({
        message: "Contact name must be at least 2 characters",
      });
    }

    if (city.trim().length < 2) {
      return res.status(400).json({
        message: "City must be at least 2 characters",
      });
    }

    if (message && message.length > 500) {
      return res.status(400).json({
        message: "Message must not exceed 500 characters",
      });
    }

    const submission = new PartnerSubmission({
      organizationName: organizationName.trim(),
      organizationType,
      contactName: contactName.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      country: country.trim(),
      city: city.trim(),
      message: message ? message.trim() : "",
    });

    await submission.save();

    res.json({
      message:
        "Partner submission received successfully! We'll contact you soon.",
      submission: {
        id: submission._id,
        organizationName: submission.organizationName,
        organizationType: submission.organizationType,
      },
    });
  } catch (error) {
    console.error("Error submitting partner form:", error);

    // Handle duplicate email submissions (if email is unique in schema)
    if (error.code === 11000) {
      return res.status(400).json({
        message: "A submission with this email already exists",
      });
    }

    // Handle validation errors from mongoose
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        message: errors.join(", "),
      });
    }

    res.status(500).json({
      message:
        error.message ||
        "An error occurred while submitting the form. Please try again.",
    });
  }
});

// GET /api/admin/partners - Get all partner submissions (Admin only)
router.get("/admin/partners", authenticate, isAdmin, async (req, res) => {
  try {
    const submissions = await PartnerSubmission.find()
      .sort({ createdAt: -1 })
      .select("-__v");

    res.json({
      count: submissions.length,
      submissions,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PATCH /api/admin/partners/:id/status - Update partner submission status (Admin only)
router.patch(
  "/admin/partners/:id/status",
  authenticate,
  isAdmin,
  async (req, res) => {
    try {
      const { status } = req.body;

      if (!["pending", "contacted", "approved", "rejected"].includes(status)) {
        return res.status(400).json({
          message: "Invalid status",
        });
      }

      const submission = await PartnerSubmission.findByIdAndUpdate(
        req.params.id,
        { status },
        { new: true }
      ).select("-__v");

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
  }
);

export default router;

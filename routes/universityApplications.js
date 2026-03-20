import express from "express";
import UniversityApplication from "../models/UniversityApplication.js";

const router = express.Router();

// POST /api/university-applications/submit - Submit university application form
router.post("/submit", async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      country,
      intendedIntake,
      preferredCourses,
      budget,
      academicDetails,
      greTaken,
      greScore,
      englishProficiencyTaken,
      englishProficiencyExam,
      englishProficiencyScore,
    } = req.body;

    // Validate required fields
    const requiredFields = {
      name: "Name",
      email: "Email",
      phone: "Phone",
      country: "Country",
      intendedIntake: "Intended intake",
      preferredCourses: "Preferred courses",
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

    if (greTaken === undefined || greTaken === null) {
      missingFields.push("GRE taken (Yes/No)");
    }
    if (englishProficiencyTaken === undefined || englishProficiencyTaken === null) {
      missingFields.push("English proficiency exam taken (Yes/No)");
    }

    if (missingFields.length > 0) {
      return res.status(400).json({
        message: `Please fill in all required fields: ${missingFields.join(", ")}`,
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({
        message: "Please provide a valid email address",
      });
    }

    // Validate phone format
    const phoneRegex =
      /^[\+]?[(]?[0-9]{1,4}[)]?[-\s.]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,9}$/;
    const cleanedPhone = phone.replace(/\s/g, "");
    if (!phoneRegex.test(cleanedPhone) || cleanedPhone.length < 7) {
      return res.status(400).json({
        message: "Please provide a valid phone number",
      });
    }

    const application = new UniversityApplication({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      country: country.trim(),
      intendedIntake: intendedIntake.trim(),
      preferredCourses: preferredCourses.trim(),
      budget: budget ? budget.trim() : "",
      academicDetails: academicDetails ? academicDetails.trim() : "",
      greTaken: Boolean(greTaken),
      greScore: greTaken && greScore ? greScore.trim() : "",
      englishProficiencyTaken: Boolean(englishProficiencyTaken),
      englishProficiencyExam: englishProficiencyTaken && englishProficiencyExam
        ? englishProficiencyExam.trim()
        : "",
      englishProficiencyScore: englishProficiencyTaken && englishProficiencyScore
        ? englishProficiencyScore.trim()
        : "",
    });

    await application.save();

    res.json({
      message:
        "Your university application has been submitted successfully! We'll be in touch soon.",
      application: {
        id: application._id,
        name: application.name,
        email: application.email,
      },
    });
  } catch (error) {
    console.error("Error submitting university application:", error);

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

export default router;

import mongoose from "mongoose";

const universityApplicationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
  },
  phone: {
    type: String,
    required: true,
    trim: true,
  },
  country: {
    type: String,
    required: true,
    trim: true,
  },
  intendedIntake: {
    type: String,
    required: true,
    trim: true,
  },
  preferredCourses: {
    type: String,
    required: true,
    trim: true,
  },
  budget: {
    type: String,
    default: "",
  },
  academicDetails: {
    type: String,
    default: "",
  },
  // GRE
  greTaken: {
    type: Boolean,
    required: true,
  },
  greScore: {
    type: String,
    default: "",
  },
  // English proficiency (TOEFL, IELTS, Duolingo)
  englishProficiencyTaken: {
    type: Boolean,
    required: true,
  },
  englishProficiencyExam: {
    type: String,
    default: "",
  },
  englishProficiencyScore: {
    type: String,
    default: "",
  },
  status: {
    type: String,
    enum: ["pending", "contacted", "processing", "submitted", "rejected"],
    default: "pending",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model(
  "UniversityApplication",
  universityApplicationSchema
);

import mongoose from "mongoose";

const partnerSubmissionSchema = new mongoose.Schema({
  organizationName: {
    type: String,
    required: true,
    trim: true,
  },
  organizationType: {
    type: String,
    required: true,
    enum: ["university", "agency"],
  },
  contactName: {
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
  city: {
    type: String,
    required: true,
    trim: true,
  },
  message: {
    type: String,
    default: "",
  },
  status: {
    type: String,
    enum: ["pending", "contacted", "approved", "rejected"],
    default: "pending",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model("PartnerSubmission", partnerSubmissionSchema);


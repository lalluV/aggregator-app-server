import mongoose from "mongoose";

const leadAssignmentSchema = new mongoose.Schema({
  agencyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Agency",
    required: true,
  },
  universityApplicationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "UniversityApplication",
    required: true,
  },
  assignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  assignedAt: {
    type: Date,
    default: Date.now,
  },
  status: {
    type: String,
    enum: ["new", "contacted", "converted", "closed"],
    default: "new",
  },
});

// Prevent duplicate assignments
leadAssignmentSchema.index(
  { agencyId: 1, universityApplicationId: 1 },
  { unique: true }
);

export default mongoose.model("LeadAssignment", leadAssignmentSchema);

import mongoose from "mongoose";

const directChatSchema = new mongoose.Schema({
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  }],
  lastMessageAt: {
    type: Date,
    default: Date.now,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Unique constraint: one chat per pair (participants sorted)
directChatSchema.index({ participants: 1 }, { unique: true });
directChatSchema.index({ lastMessageAt: -1 });

export default mongoose.model("DirectChat", directChatSchema);

import mongoose from "mongoose";

const chatMessageSchema = new mongoose.Schema({
  group: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "UniversityGroup",
    required: true,
    index: true,
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  messageType: {
    type: String,
    enum: ["text", "image", "file"],
    default: "text",
  },
  content: {
    type: String,
    required: function() {
      return this.messageType === "text";
    },
  },
  mediaUrl: {
    type: String,
    required: function() {
      return this.messageType === "image" || this.messageType === "file";
    },
  },
  fileName: {
    type: String,
  },
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "ChatMessage",
  },
  reactions: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    emoji: String,
  }],
  mentions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  }],
  isEdited: {
    type: Boolean,
    default: false,
  },
  isDeleted: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Compound index for efficient message retrieval
chatMessageSchema.index({ group: 1, createdAt: -1 });
chatMessageSchema.index({ sender: 1 });

// Update updatedAt on save
chatMessageSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

export default mongoose.model("ChatMessage", chatMessageSchema);



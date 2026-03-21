import admin from "firebase-admin";

let initialized = false;

export function initFirebase() {
  if (initialized) return;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    console.warn(
      "Firebase env vars not set — push notifications disabled"
    );
    return;
  }

  try {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
    initialized = true;
    console.log("Firebase Admin initialized for push notifications");
  } catch (error) {
    console.error("Failed to initialize Firebase Admin:", error.message);
  }
}

export function isFirebaseReady() {
  return initialized;
}

export async function sendPushNotifications(tokens, payload) {
  if (!initialized || tokens.length === 0) return;

  const message = {
    notification: {
      title: payload.title,
      body: payload.body,
    },
    data: payload.data || {},
    tokens,
  };

  try {
    const response = await admin.messaging().sendEachForMulticast(message);

    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const code = resp.error?.code;
          if (
            code === "messaging/invalid-registration-token" ||
            code === "messaging/registration-token-not-registered"
          ) {
            failedTokens.push(tokens[idx]);
          }
        }
      });
      return { failedTokens };
    }

    return { failedTokens: [] };
  } catch (error) {
    console.error("Error sending push notifications:", error.message);
    return { failedTokens: [] };
  }
}

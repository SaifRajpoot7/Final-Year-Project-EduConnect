// // config/nodeMailer.js
import dotenv from "dotenv";
dotenv.config();

// import nodemailer from "nodemailer";

// const transporter = nodemailer.createTransport({
//   host: process.env.SMTP_SERVER,
//   port: Number(process.env.SMTP_PORT),
//   secure: false, // true only for port 465
//   auth: {
//     user: process.env.SMTP_LOGIN,
//     pass: process.env.SMTP_PASSWORD,
//   },
// });

// export default transporter;

import SibApiV3Sdk from "sib-api-v3-sdk";

// Initialize Brevo (Sendinblue) API client
const defaultClient = SibApiV3Sdk.ApiClient.instance;
defaultClient.authentications['api-key'].apiKey = process.env.BREVO_API_KEY;

// Helper to validate the sender
function getVerifiedSender() {
  const sender = process.env.BREVO_SENDER;
  if (!sender || !sender.includes("@")) {
    throw new Error(
      "BREVO_SENDER is not set or invalid. Please set a verified sender email in your environment variables."
    );
  }
  return sender;
}

// Create a "fake" transporter object with sendMail()
const transporter = {
  sendMail: async (mailOptions) => {
    if (!mailOptions.to) throw new Error("Recipient email (to) is required");
    if (!mailOptions.subject) throw new Error("Email subject is required");

    const tranEmailApi = new SibApiV3Sdk.TransactionalEmailsApi();

    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail({
      to: [{ email: mailOptions.to }],
      sender: {
        email: getVerifiedSender(), // validated sender
        name: mailOptions.fromName || "Saif App",
      },
      subject: mailOptions.subject,
      htmlContent: mailOptions.html || "<p>This is a test email</p>",
    });

    try {
      return await tranEmailApi.sendTransacEmail(sendSmtpEmail);
    } catch (err) {
      // More informative error message
      throw new Error(
        `Failed to send email: ${err?.response?.text || err.message}`
      );
    }
  },
};

export default transporter;

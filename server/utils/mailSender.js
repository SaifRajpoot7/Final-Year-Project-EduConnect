import { BrevoClient } from '@getbrevo/brevo';

// 1. Initialize the client using your API Key
const client = new BrevoClient({
  apiKey: process.env.BREVO_API_KEY,
});

/**
 * @param {Object} mailDetails - contains { email, subject, body }
 */
const mailSender = async (mailDetails) => {
  const { email, subject, body } = mailDetails;

  try {
    // 2. In this version, we usually call sendTransacEmail directly from the client
    const response = await client.transactionalEmails.sendTransacEmail({
      subject: subject,
      htmlContent: body,
      sender: { 
        name: "EduConnect", 
        email: process.env.BREVO_SENDER
      },
      to: [{ email: String(email).trim() }],
    });

    // console.log("Brevo: Email sent successfully.");
    return response;
  } catch (error) {
    // This version uses 'BrevoError' internally
    console.error("Brevo Error:", error.message);
    throw error;
  }
};

export default mailSender;
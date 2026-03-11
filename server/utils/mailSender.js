// utils/mailSender.js
import transporter from "../config/nodeMailerConfig.js";

const buildMailOptions = (mailDetails) => ({
  from: `"EduConnect" <${process.env.SMTP_SENDER}>`,
  to: mailDetails.email,
  subject: mailDetails.subject,
  html:
    typeof mailDetails.body === "function"
      ? mailDetails.body({
        name: mailDetails.name,
        email: mailDetails.email,
        url: mailDetails.url,
      })
      : mailDetails.body,
});


const mailSender = async (mailDetails) => {
  try {
    const info = await transporter.sendMail(buildMailOptions(mailDetails));
    // console.log(`✅ Email sent to ${mailDetails.email}: ${info.messageId}`);
    return info;
  } catch (error) {
    // console.error(`❌ Failed to send email to ${mailDetails.email}:`, error.message);
    throw error;
  }
};

export default mailSender;

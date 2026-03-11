// config/nodeMailer.js
import dotenv from "dotenv";
dotenv.config();

import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_SERVER,
  port: Number(process.env.SMTP_PORT),
  secure: false, // true only for port 465
  auth: {
    user: process.env.SMTP_LOGIN,
    pass: process.env.SMTP_PASSWORD,
  },
});

export default transporter;

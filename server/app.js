import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import connectToDb from './config/database.js';
import userRouter from './routes/user.routes.js';
import courseRouter from './routes/course.routes.js';
import assignmentRouter from './routes/assignment/assignment.route.js';
import quizRouter from './routes/quiz.routes.js';
import announcementRouter from './routes/announcement.routes.js';
import lectureRouter from "./routes/lecture.routes.js"
import { generateToken } from './controllers/generateStreamToken.controller.js';
import requireAuth from './middlewares/requireAuth.middleware.js';
import nodeCron from 'node-cron';
import lectureController from './controllers/lecture.controller.js';
import superAdminRouter from './routes/superAdmin.routes.js';
import feedbackRouter from './routes/feedback.routes.js';
import discussionRouter from './routes/discussion.router.js';

const app = express();

connectToDb();

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// app.use(cors({ origin: allowedOrigins, credentials: true }));
const allowedOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(",")
  : [];

app.use(cors({
  origin: (origin, callback) => {
    // allow server-to-server / Postman requests
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  credentials: true
}));


// Schedule: Run every 10 minutes
nodeCron.schedule('*/10 * * * *', () => {
  lectureController.markMissedLectures();
});


app.use('/api/user', userRouter);
app.use('/api/super-admin', superAdminRouter);
app.use('/api/course', courseRouter);
app.use('/api/assignment', assignmentRouter);
app.use('/api/quiz', quizRouter);
app.use('/api/announcement', announcementRouter);
app.use("/api/lectures", lectureRouter);
app.use("/api/feedback", feedbackRouter);
app.use("/api/discussion", discussionRouter);
app.use("/api/generate-stream-token", requireAuth, generateToken);



app.get('/', (req, res) => {
  res.send('Hello World');
});


export default app;
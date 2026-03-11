import jwt from 'jsonwebtoken';
import User from '../models/user.model.js';
import Course from '../models/course.model.js'
import Lecture from '../models/lecture.model.js';
import Assignment from '../models/assignments/assignment.model.js';
import Quiz from '../models/quiz/quiz.model.js';
import hashPasswordUtils from '../utils/hashPassword.js';
import mailSender from '../utils/mailSender.js';
import { accountConfirmationWelcomeEmailTemplate, accountVerificationEmailTemplate, } from '../utils/emailTemplates.js';
import DailyStat from '../models/dailyActiveUserStat.model.js';
import Appeal from '../models/appeal.model.js';
import { uploadOnCloudinary } from '../utils/cloudinary.js'
import AssignmentSubmission from '../models/assignments/assignmentSubmission.model.js';
import QuizSubmission from '../models/quiz/quizSubmission.model.js';


const trackDailyActiveUser = async (userId) => {
  try {
    const today = new Date().toISOString().split('T')[0]; // "2026-01-04"

    // This single command does everything:
    // 1. Finds the document for 'today'.
    // 2. If not found, creates it (upsert: true).
    // 3. Adds userId to 'loginIds' ONLY if it doesn't exist ($addToSet).
    // 4. We calculate 'activeUsers' count later by just measuring the array length.

    await DailyStat.updateOne(
      { date: today },
      { $addToSet: { loginIds: userId } },
      { upsert: true }
    );

    // Note: We are NOT using a separate 'activeUsers' number field here to avoid 
    // sync issues. We will just count the array length when we display the chart.

  } catch (error) {
    console.log("Error tracking DAU:", error.message);
    // We catch the error here so it doesn't crash the main app flow
  }
};


const registerUser = async (req, res) => {
  const { email, fullName, password } = req.body;
  if (!email || !fullName || !password) {
    return res.json({ success: false, message: 'All Fields Require' });
  }
  try {
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }
    // Hash the password
    const hashedPassword = await hashPasswordUtils.generateHashPassword(password);
    // Verification OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString(); // Generate a 6-digit OTP
    const otpTimeOut = Date.now() + 30 * 60 * 1000
    // Create new user
    const user = new User({
      email,
      fullName,
      password: hashedPassword,
      verificationOtp: otp,
      verificationOtpTimeOut: otpTimeOut,
    });
    // Save user to the database
    await user.save();
    // Exclude password from the response
    user.password = undefined;
    // Sendig Verfication OTP Mail

    const today = new Date().toISOString().split('T')[0];

    DailyStat.updateOne(
      { date: today },
      { $inc: { newUsers: 1 } },
      { upsert: true }
    ).catch(err => console.error("Stats Error:", err));

    // JWT Token
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    // Set Cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    })
    // Send account veriication otp email
    const mailDetails = {
      email: user.email,
      subject: "Verify Your EduConnect Account",
      body: accountVerificationEmailTemplate({
        name: user.fullName,
        otp: otp,
        url: `${process.env.CLIENT_URL}/account-verification`,
      }),
    };

    mailSender(mailDetails)

    return res.status(201).json({
      success: true,
      message: 'User registered successfully',
    });
  }
  catch (error) {
    console.error('Error registering user:', error);
    return res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
}

const userLogin = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'All Fields Require' });
  }
  try {
    // Find user by email
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Email or password is incorrect' });
    }
    // Verify password
    const isPasswordValid = await hashPasswordUtils.verifyPassword(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: 'Email or password is incorrect' });
    }
    // Exclude password from the response
    user.password = undefined;
    // JWT Token
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    // Set Cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    })

    return res.status(200).json({
      success: true,
      message: 'User SignedIn successfully',
    });

  } catch (error) {
    console.error('Error logging in user:', error);
    return res.status(500).json({ success: false, message: error.message || 'Internal server error' });

  }
}

// Super Admin Login
const superAdminLogin = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'All Fields Required' });
  }

  try {
    // 1. Find user and explicitly select the password field
    const user = await User.findOne({ email }).select('+password');

    // 2. Basic Check: Does user exist?
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // 3. SECURITY CHECK: Is this user actually a Super Admin?
    // If a regular student tries to login here, we block them immediately.
    if (user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access Denied: You do not have administrative privileges.'
      });
    }

    // 4. Verify Password
    const isPasswordValid = await hashPasswordUtils.verifyPassword(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // 5. Exclude password from response
    user.password = undefined;

    // 6. Generate Token
    // It is good practice to include the role in the token payload for admins
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1d' } // Admin sessions are usually shorter (e.g., 1 day) for security
    );

    // 7. Set Cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 1 Day
    });

    return res.status(200).json({
      success: true,
      message: 'Welcome back, Super Admin',
      user: user // Frontend can now redirect to /admin/dashboard
    });

  } catch (error) {
    console.error('Error logging in super admin:', error);
    return res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
};

const userLogout = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized: No user found in request' });
    }
    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
    });
    return res.status(200).json({ success: true, message: 'User logged out successfully' });
  } catch (error) {
    console.error('Error logging out user:', error);
    return res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
};

const userProfile = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized: No user found in request' });
    }
    const userObject = req.user.toObject ? req.user.toObject() : req.user;
    const { verificationOtp, verificationOtpTimeOut, resetToken, resetTokenTimeOut, ...safeUser } = userObject;
    trackDailyActiveUser(req.user._id);
    res.status(200).json({
      success: true,
      userData: safeUser,
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    return res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
};

const generateVerificationOtp = async (req, res) => {
  const userId = req.user._id;
  if (!userId) {
    return res.status(400).json({ success: false, message: 'Must be Logged in to get OTP' });
  }
  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(400).json({ success: false, message: 'User not found' });
    }
    // Verification OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString(); // Generate a 6-digit OTP
    user.verificationOtp = otp;
    user.verificationOtpTimeOut = Date.now() + 30 * 60 * 1000;
    await user.save();
    const mailDetails = {
      email: user.email,
      subject: "Verify Your EduConnect Account",
      body: accountVerificationEmailTemplate({
        name: user.fullName,
        otp: otp,
        url: `${process.env.CLIENT_URL}/account-verification`,
      }),
    };

    mailSender(mailDetails)
    res.status(200).json({ success: true, message: 'OTP Sent Successfully' });
  } catch (error) {
    console.error('Error generating Verification OTP:', error);
    return res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
}

const verifyAccount = async (req, res) => {
  const { otp } = req.body;
  const userId = req.user._id;
  if (!userId) {
    return res.status(400).json({ success: false, message: 'Must be Logged in to verify Account' });
  }
  if (!otp) {
    return res.status(400).json({ success: false, message: 'OTP is required' });
  }
  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (user.verificationOtp !== otp.trim()) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }
    if (Date.now() > user.verificationOtpTimeOut) {
      return res.status(400).json({ success: false, message: 'OTP has expired' });
    }
    user.isVerified = true;
    user.verificationOtp = '';
    user.verificationOtpTimeOut = 0;
    await user.save();
    // Send account confirmation and welcome email
    const mailDetails = {
      email: user.email,
      subject: "Welcome to EduConnect | A Virtual Learning Platform",
      body: accountConfirmationWelcomeEmailTemplate({
        name: user.fullName,
        url: `${process.env.CLIENT_URL}/dashboard`,
      }),
    };

    mailSender(mailDetails)

    return res.status(200).json({ success: true, message: 'User verified successfully' });
  } catch (error) {
    console.error('Error verifying OTP:', error);
    return res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
}

const checkAuth = async (req, res) => {
  res.status(200).json({
    success: true,
    message: 'User is authenticated',
  });
}

//Submit a new Appeal
const createAccountActivationAppeal = async (req, res) => {
  const { message } = req.body;
  const userId = req.user._id;

  try {
    // Validation
    if (!message) {
      return res.status(400).json({ success: false, message: "Please provide a reason for your appeal." });
    }

    const user = await User.findById(userId);

    // Only allow appeals if user is actually suspended/blocked
    if (user.status === 'active') {
      return res.status(400).json({ success: false, message: "Your account is active. You cannot submit an appeal." });
    }

    // Check if there is already a PENDING appeal
    const existingAppeal = await Appeal.findOne({ userId, status: 'pending' });
    if (existingAppeal) {
      return res.status(400).json({ success: false, message: "You already have a pending appeal under review." });
    }

    // Create Appeal
    const newAppeal = new Appeal({
      userId,
      message,
      status: 'pending'
    });

    await newAppeal.save();

    res.status(201).json({ success: true, message: "Appeal submitted successfully. We will review it shortly." });

  } catch (error) {
    console.error("Create Appeal Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get User's Latest Appeal Status (For the blocked page UI)
const getMyAccountActivationAppeal = async (req, res) => {
  try {
    // Get the most recent appeal
    const appeal = await Appeal.findOne({ userId: req.user._id }).sort({ createdAt: -1 });

    res.status(200).json({ success: true, appeal });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


const updateProfile = async (req, res) => {
  try {
    const { fullName } = req.body;
    const userId = req.user._id;

    let updateData = { fullName };

    // Handle Image Upload if provided
    if (req.file) {
      const result = await uploadOnCloudinary(req.file.path);
      if (result) {
        updateData.profilePicture = result.secure_url; // Assuming your model has this field
      }
    }

    const updatedUser = await User.findByIdAndUpdate(userId, updateData, { new: true }).select("-password");

    res.status(200).json({ success: true, message: "Profile updated successfully", user: updatedUser });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user._id;

    const user = await User.findById(userId).select('+password');

    // Verify Old Password
    const isMatch = await hashPasswordUtils.verifyPassword(oldPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Incorrect old password." });
    }

    // Hash New Password
    const hashedPassword = await hashPasswordUtils.generateHashPassword(newPassword);
    user.password = hashedPassword;

    await user.save();

    res.status(200).json({ success: true, message: "Password changed successfully." });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getOverviewCards = async (req, res) => {
  try {
    const userId = req.user._id;
    const userEmail = req.user.email;

    // 1. Setup Date Ranges
    // "Start of Today" (00:00:00)
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // "End of Today" (23:59:59) - Used for upcoming lectures check
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    // 2. Fetch User's Courses
    // We need the IDs of the courses the user belongs to (either as teacher or student)
    // to filter the assignments, quizzes, and lectures correctly.
    const userCourses = await Course.find({
      $or: [
        { teacher: userId },
        { students: userEmail }
      ]
    }).select('_id');

    const userCourseIds = userCourses.map(course => course._id);
    const totalCourse = userCourseIds.length;

    // 3. Fetch Metrics in Parallel
    // We use Promise.all to run these three database queries simultaneously for better performance.
    const [activeAssignments, activeQuizzes, upcomingLectures] = await Promise.all([

      // Active Assignments: Due today or in the future
      Assignment.countDocuments({
        course: { $in: userCourseIds },
        dueDate: { $gte: startOfToday }
      }),

      // Active Quizzes: Due today or in the future
      Quiz.countDocuments({
        course: { $in: userCourseIds },
        dueDate: { $gte: startOfToday }
      }),

      // Upcoming Lectures: Status is 'upcoming' AND scheduled for today
      Lecture.countDocuments({
        course: { $in: userCourseIds },
        status: 'upcoming',
        scheduledStart: {
          $gte: startOfToday,
          $lte: endOfToday
        }
      })
    ]);

    // 4. Return Response
    return res.status(200).json({
      success: true,
      data: {
        totalCourse,
        activeAssignments,
        activeQuizzes,
        upcomingLectures
      }
    });

  } catch (error) {
    console.error("Overview Cards Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard overview"
    });
  }
};

const getStudentPerformance = async (req, res) => {
  try {
    const userId = req.user._id;

    // 1. Define the Time Window (Last 5 Weeks)
    const today = new Date();
    const fiveWeeksAgo = new Date();
    fiveWeeksAgo.setDate(today.getDate() - 35); // 35 days ago

    // 2. Fetch Graded Submissions concurrently
    // We filter by 'student', 'createdAt' date, and ensure marks exist.
    const [assignmentSubmissions, quizSubmissions] = await Promise.all([

      // Fetch Assignment Submissions
      AssignmentSubmission.find({
        student: userId,
        createdAt: { $gte: fiveWeeksAgo },
        marksObtained: { $ne: null } // Only fetch if marks have been given
      }).populate('assignment', 'maxMarks title'),

      // Fetch Quiz Submissions
      QuizSubmission.find({
        student: userId,
        createdAt: { $gte: fiveWeeksAgo },
        // Assuming all quiz submissions in DB are "attempts". 
        // If you have "in-progress" quizzes, add a status check here.
      }).populate('quiz', 'maxMarks title')
    ]);

    // 3. Initialize Weekly Buckets (Week 1 = Oldest, Week 5 = Current)
    const weeklyData = [];

    for (let i = 4; i >= 0; i--) {
      const endOfWeek = new Date();
      endOfWeek.setDate(today.getDate() - (i * 7));

      const startOfWeek = new Date();
      startOfWeek.setDate(today.getDate() - ((i + 1) * 7));

      // Set precise timestamps for accurate comparison
      startOfWeek.setHours(0, 0, 0, 0);
      endOfWeek.setHours(23, 59, 59, 999);

      weeklyData.push({
        weekLabel: `Week ${5 - i}`, // "Week 1", "Week 2"...
        startDate: startOfWeek,
        endDate: endOfWeek,
        totalPercentage: 0,
        submissionCount: 0
      });
    }

    // 4. Helper to calculate percentage and place in bucket
    const processGrade = (submission, type) => {
      const date = new Date(submission.createdAt || submission.submittedAt);

      let obtained = 0;
      let max = 0;

      if (type === 'assignment') {
        obtained = submission.marksObtained;
        max = submission.assignment?.maxMarks;
      } else {
        obtained = submission.obtainedMarks;
        max = submission.quiz?.maxMarks;
      }

      // Safety: Skip if max marks is missing or zero (prevent division by zero)
      if (!max || max === 0) return;

      // Calculate percentage
      const percentage = (obtained / max) * 100;

      // Find the correct weekly bucket
      const bucket = weeklyData.find(w =>
        date >= w.startDate && date <= w.endDate
      );

      if (bucket) {
        bucket.totalPercentage += percentage;
        bucket.submissionCount += 1;
      }
    };

    // 5. Process both lists
    assignmentSubmissions.forEach(sub => processGrade(sub, 'assignment'));
    quizSubmissions.forEach(sub => processGrade(sub, 'quiz'));

    // 6. Final Format for Frontend
    const chartData = weeklyData.map(week => ({
      name: week.weekLabel,
      dateRange: `${week.startDate.toLocaleDateString()} - ${week.endDate.toLocaleDateString()}`,
      performance: week.submissionCount > 0
        ? Math.round(week.totalPercentage / week.submissionCount)
        : 0 // Return 0 if no graded work exists for that week
    }));

    return res.status(200).json({
      success: true,
      data: chartData
    });

  } catch (error) {
    console.error("Student Performance Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to calculate student performance"
    });
  }
};

const getAssignmentQuizStatus = async (req, res) => {
  try {
    const userId = req.user._id;
    const userEmail = req.user.email;

    // 1. Find Enrolled Courses
    // We need to know which courses the student is in to find the relevant tasks.
    const enrolledCourses = await Course.find({
      students: userEmail
    }).select('_id');

    const courseIds = enrolledCourses.map(c => c._id);

    if (courseIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: [] // Return empty if no courses
      });
    }

    // 2. Fetch All Data in Parallel
    // We grab all tasks for these courses AND all submissions by this user
    const [
      allAssignments,
      allQuizzes,
      myAssignmentSubmissions,
      myQuizSubmissions
    ] = await Promise.all([
      // Get all assignments for my courses
      Assignment.find({ course: { $in: courseIds } }).select('_id dueDate'),

      // Get all quizzes for my courses
      Quiz.find({ course: { $in: courseIds } }).select('_id dueDate'),

      // Get my actual submissions
      AssignmentSubmission.find({ student: userId }).select('assignment'),
      QuizSubmission.find({ student: userId }).select('quiz')
    ]);

    // 3. Create Sets for Fast Lookup
    // This lets us instantly check "Did I submit assignment X?"
    const submittedAssignmentIds = new Set(
      myAssignmentSubmissions.map(s => s.assignment.toString())
    );
    const submittedQuizIds = new Set(
      myQuizSubmissions.map(s => s.quiz.toString())
    );

    // 4. Calculate Metrics
    const now = new Date();

    // --- Assignments Logic ---
    const assignmentsCompleted = submittedAssignmentIds.size;

    let assignmentsPending = 0;
    let assignmentsMissed = 0;

    allAssignments.forEach(assignment => {
      // If I have NOT submitted this assignment...
      if (!submittedAssignmentIds.has(assignment._id.toString())) {
        if (new Date(assignment.dueDate) > now) {
          assignmentsPending++; // Due date is in the future
        } else {
          assignmentsMissed++;  // Due date is in the past
        }
      }
    });

    // --- Quizzes Logic ---
    const quizzesAttempted = submittedQuizIds.size;

    let quizzesMissed = 0;

    // Note: Quizzes usually don't have "Pending" in the same way as assignments 
    // (you either take them or miss them), but you can add a 'Quizzes Pending' 
    // logic here if needed. For now, we only calculate 'Missed' based on your request.
    allQuizzes.forEach(quiz => {
      if (!submittedQuizIds.has(quiz._id.toString())) {
        if (new Date(quiz.dueDate) < now) {
          quizzesMissed++;
        }
      }
    });

    // 5. Format for the Chart (Pie/Donut Chart)
    // Matching the colors from your uploaded image
    const chartData = [
      { name: "Assignments Completed", value: assignmentsCompleted, fill: "#00C49F" }, // Green
      { name: "Assignments Pending", value: assignmentsPending, fill: "#FFBB28" },   // Yellow
      { name: "Deadlines Missed", value: assignmentsMissed, fill: "#FF8042" },       // Orange/Red
      { name: "Quizzes Attempted", value: quizzesAttempted, fill: "#0088FE" },       // Blue
      { name: "Quizzes Missed", value: quizzesMissed, fill: "#FF8042" }              // Reddish (same as deadlines missed usually, or distinct)
    ];

    // Optional: Filter out zero values so the chart looks cleaner


    return res.status(200).json({
      success: true,
      data: chartData
    });

  } catch (error) {
    console.error("Assignment/Quiz Status Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch status data"
    });
  }
};

const teacherStudentPerformance = async (req, res) => {
  try {
    const teacherId = req.user._id;

    // 1. Get all Task IDs created by this teacher
    // We find all assignments and quizzes where 'teacher' matches the current user.
    const [assignments, quizzes] = await Promise.all([
      Assignment.find({ teacher: teacherId }).select('_id maxMarks'),
      Quiz.find({ teacher: teacherId }).select('_id maxMarks')
    ]);

    // Create Maps for O(1) lookup of Max Marks
    const assignmentMaxMap = new Map(assignments.map(a => [a._id.toString(), a.maxMarks]));
    const quizMaxMap = new Map(quizzes.map(q => [q._id.toString(), q.maxMarks]));

    const assignmentIds = assignments.map(a => a._id);
    const quizIds = quizzes.map(q => q._id);

    // 2. Fetch all student submissions for these tasks
    // We only care about submissions related to this teacher's work
    const [assignmentSubs, quizSubs] = await Promise.all([
      AssignmentSubmission.find({
        assignment: { $in: assignmentIds },
        marksObtained: { $ne: null } // Only graded ones
      }).select('student assignment marksObtained'),

      QuizSubmission.find({
        quiz: { $in: quizIds },
        obtainedMarks: { $exists: true } // Only graded ones
      }).select('student quiz obtainedMarks')
    ]);

    // 3. Aggregate Scores per Student
    // Structure: { studentId: { obtained: 0, max: 0 } }
    const studentStats = {};

    // Helper to accumulate stats
    const addScore = (studentId, obtained, max) => {
      if (!max || max === 0) return; // Skip invalid max marks

      if (!studentStats[studentId]) {
        studentStats[studentId] = { obtained: 0, max: 0 };
      }
      studentStats[studentId].obtained += obtained;
      studentStats[studentId].max += max;
    };

    // Process Assignments
    assignmentSubs.forEach(sub => {
      const max = assignmentMaxMap.get(sub.assignment.toString()) || 0;
      addScore(sub.student.toString(), sub.marksObtained, max);
    });

    // Process Quizzes
    quizSubs.forEach(sub => {
      const max = quizMaxMap.get(sub.quiz.toString()) || 0;
      addScore(sub.student.toString(), sub.obtainedMarks, max);
    });

    // 4. Categorize Students into Buckets
    const buckets = {
      weak: 0,      // 0-40%
      average: 0,   // 41-60%
      good: 0,      // 61-80%
      excellent: 0  // 81-100%
    };

    Object.values(studentStats).forEach(stat => {
      const percentage = (stat.obtained / stat.max) * 100;

      if (percentage <= 40) {
        buckets.weak++;
      } else if (percentage <= 60) {
        buckets.average++;
      } else if (percentage <= 80) {
        buckets.good++;
      } else {
        buckets.excellent++;
      }
    });

    // 5. Format Data for Frontend Chart
    const chartData = [
      { name: "Weak (0-40%)", value: buckets.weak, fill: "#ef4444" },      // Red
      { name: "Average (41-60%)", value: buckets.average, fill: "#f59e0b" }, // Orange/Yellow
      { name: "Good (61-80%)", value: buckets.good, fill: "#3b82f6" },       // Blue
      { name: "Excellent (81-100%)", value: buckets.excellent, fill: "#10b981" } // Green
    ];

    return res.status(200).json({
      success: true,
      data: chartData
    });

  } catch (error) {
    console.error("Teacher Performance Overview Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch student performance data"
    });
  }
};

const getTeacherWorkload = async (req, res) => {
  try {
    const teacherId = req.user._id;

    // 1. Fetch Assignments first
    // We need the IDs of the assignments created by this teacher 
    // to calculate how many student submissions are pending for them.
    const teacherAssignments = await Assignment.find({ teacher: teacherId }).select('_id');
    const teacherAssignmentIds = teacherAssignments.map(a => a._id);

    // 2. Fetch Metrics in Parallel
    const [
      lecturesDelivered,
      quizzesCreated,
      pendingReviews
    ] = await Promise.all([

      // Lectures Delivered: Status must be 'ended'
      Lecture.countDocuments({
        teacher: teacherId,
        status: 'ended'
      }),

      // Quizzes Created: Simple count by teacher
      Quiz.countDocuments({
        teacher: teacherId
      }),

      // Pending Reviews: Submissions for this teacher's assignments 
      // that are NOT yet 'graded' (includes 'submitted' and 'late')
      AssignmentSubmission.countDocuments({
        assignment: { $in: teacherAssignmentIds },
        status: { $ne: 'graded' }
      })
    ]);

    // 3. Construct Data Object
    const workloadData = [
      {
        title: "Lectures Delivered",
        count: lecturesDelivered,
        icon: "Video", // Identifiers for frontend icons
        color: "#3b82f6" // Blue
      },
      {
        title: "Assignments Created",
        count: teacherAssignments.length, // We already fetched these above
        icon: "FileText",
        color: "#10b981" // Green
      },
      {
        title: "Quizzes Created",
        count: quizzesCreated,
        icon: "HelpCircle",
        color: "#f59e0b" // Yellow
      },
      {
        title: "Pending Reviews",
        count: pendingReviews,
        icon: "Clock",
        color: "#ef4444" // Red
      }
    ];

    return res.status(200).json({
      success: true,
      data: workloadData
    });

  } catch (error) {
    console.error("Teacher Workload Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch workload stats"
    });
  }
};

const updateDashboardType = async (req, res) => {
  try {
    const userId = req.user._id;
    const { dashboardType } = req.body;

    // 1. Validate Input
    const validTypes = ["general", "student", "teacher"];

    if (!dashboardType || !validTypes.includes(dashboardType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid dashboard type. Must be one of: ${validTypes.join(", ")}`
      });
    }

    // 2. Update User
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { dashboardType: dashboardType },
      { new: true } // Return the updated document
    ).select("-password"); // Exclude password from response

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // 3. Return Success
    return res.status(200).json({
      success: true,
      message: `Dashboard view switched to ${dashboardType}`,
      data: updatedUser
    });

  } catch (error) {
    console.error("Update Dashboard Type Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update dashboard preference"
    });
  }
};

const userController = {
  registerUser,
  userLogin,
  superAdminLogin,
  userLogout,
  userProfile,
  generateVerificationOtp,
  verifyAccount,
  checkAuth,
  createAccountActivationAppeal,
  getMyAccountActivationAppeal,
  updateProfile,
  changePassword,
  getOverviewCards,
  getStudentPerformance,
  getAssignmentQuizStatus,
  teacherStudentPerformance,
  getTeacherWorkload,
  updateDashboardType,
};

export default userController;
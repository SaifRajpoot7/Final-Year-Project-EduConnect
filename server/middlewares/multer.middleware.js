// import multer from "multer";

// const storage = multer.diskStorage({
//     destination: function (req, file, cb) {
//       cb(null, "./temp/media")
//     },
//     filename: function (req, file, cb) {
      
//       cb(null, file.originalname)
//     }
//   })
  
// export const upload = multer({ 
//     storage, 
// })

import multer from "multer";
import fs from "fs";

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "./temp/media";
    
    // Check if directory exists, if not, create it
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    // Note: Using originalname can lead to overwrites if two users upload "image.png"
    cb(null, file.originalname);
  }
});

export const upload = multer({ 
  storage, 
});
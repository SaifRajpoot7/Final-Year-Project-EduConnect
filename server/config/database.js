import mongoose from 'mongoose';
import dotenv from "dotenv";
dotenv.config();

const connectToDb = async () => {
    try {
        await mongoose.connect(process.env.DB_CONNECT);
        console.log('Connected to DB');
    } catch (err) {
        console.log(err);
    }
}


export default connectToDb;
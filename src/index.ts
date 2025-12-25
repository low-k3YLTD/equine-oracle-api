import express, { Request, Response } from 'express';
import cors from 'cors';
import { authMiddleware } from './middleware/authMiddleware';
import { getMlPredictions } from './services/mlPredictionService';

const app = express();
const PORT = Number(process.env.PORT) || 8080;

app.use(express.json());

// CORS Configuration
const allowedOrigins = ['*'];  // Allow all — remove later for prod security
];

const corsOptions = {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    optionsSuccessStatus: 204
};

app.use(cors(corsOptions));

// Public: Model Info
app.get('/api/model_info', (req: Request, res: Response) => {
    res.json({
        modelName: "Equine Oracle Ensemble Predictor",
        version: "2.0-oracle-engine",
        description: "Ensemble model combining LightGBM Ranker with various classification models (LR, RF, GB, XGB) for horse race win probability prediction.",
        inputFeatures: [
            "distance", "distance_numeric", "year", "month", "day", "day_of_week",
            "week_of_year", "days_since_last_race", "PREV_RACE_WON", "WIN_STREAK",
            "IMPLIED_PROBABILITY", "NORMALIZED_VOLUME", "MARKET_ACTIVITY_WINDOW_HOURS"
        ],
        output: {
            probability: "Win probability (0.0 to 1.0)",
            confidence: "Model confidence (0.0 to 1.0)"
        }
    });
});

// Public: Single Prediction
app.post('/api/predict', async (req: Request, res: Response) => {
    const { raceId, horseId, features } = req.body;

    if (!features || typeof features !== 'object') {
        return res.status(400).json({ error: 'Invalid or missing features in request body.' });
    }

    try {
        const predictions = await getMlPredictions([features]);
        if (predictions.length === 0) {
            return res.status(500).json({ error: 'Prediction service failed to return a result.' });
        }

        const prediction = predictions[0];

        res.json({
            raceId,
            horseId,
            prediction: prediction.probability,
            confidence: prediction.confidence,
            modelVersion: '2.0-oracle-engine'
        });
    } catch (error) {
        console.error("Error in /api/predict:", error);
        res.status(500).json({ error: 'Internal server error during prediction.' });
    }
});

// Authenticated routes
app.use('/api', authMiddleware);

// Placeholder streak prediction
app.post('/api/predict_streak', (req: Request, res: Response) => {
    res.status(501).json({
        error: 'Not Implemented',
        message: 'The four-race streak prediction endpoint is a placeholder and requires a dedicated model.'
    });
});

// Health check
app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ status: 'healthy', uptime: process.uptime() });
});

// Start server — ONLY ONCE
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
    console.log(`Health check: http://0.0.0.0:${PORT}/health`);
});

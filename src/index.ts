import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { authMiddleware } from './middleware/authMiddleware';
import { getMlPredictions } from './services/mlPredictionService';

const app = express();
const PORT = Number(process.env.PORT) || 8080;

// Middleware
app.use(express.json({ limit: '10mb' })); // Prevent payload too large

// CORS — Wildcard for MVP, tighten later
app.use(
  cors({
    origin: true, // Reflect request origin (or set to '*' for full wildcard)
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
    optionsSuccessStatus: 204,
  })
);

// Global error handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Health Check — Railway loves this
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Public: Model Info
app.get('/api/model_info', (req: Request, res: Response) => {
  res.json({
    modelName: 'Equine Oracle Ensemble Predictor',
    version: '2.0-oracle-engine',
    description:
      'Ensemble model combining LightGBM Ranker with various classification models (LR, RF, GB, XGB) for horse race win probability prediction.',
    inputFeatures: [
      'distance',
      'distance_numeric',
      'year',
      'month',
      'day',
      'day_of_week',
      'week_of_year',
      'days_since_last_race',
      'PREV_RACE_WON',
      'WIN_STREAK',
      'IMPLIED_PROBABILITY',
      'NORMALIZED_VOLUME',
      'MARKET_ACTIVITY_WINDOW_HOURS',
    ],
    output: {
      probability: 'Win probability (0.0 to 1.0)',
      confidence: 'Model confidence (0.0 to 1.0)',
    },
  });
});

// Public: Single Prediction (MVP)
app.post('/api/predict', async (req: Request, res: Response) => {
  const { raceId, horseId, features } = req.body;

  if (!features || typeof features !== 'object' || Object.keys(features).length === 0) {
    return res.status(400).json({ error: 'Invalid or missing features in request body.' });
  }

  try {
    const predictions = await getMlPredictions([features]);

    if (!predictions || predictions.length === 0) {
      return res.status(500).json({ error: 'Prediction service returned no result.' });
    }

    const { probability, confidence } = predictions[0];

    // Future: log to monitoring DB here
    console.log(`Prediction made | raceId: ${raceId} | horseId: ${horseId} | prob: ${probability.toFixed(4)} | conf: ${confidence.toFixed(4)}`);

    res.json({
      raceId,
      horseId,
      probability,
      confidence,
      modelVersion: '2.0-oracle-engine',
    });
  } catch (error) {
    console.error('Prediction error:', error);
    res.status(500).json({ error: 'Failed to generate prediction.' });
  }
});

// Authenticated routes prefix
app.use('/api', authMiddleware);

// Auth-protected: Streak prediction placeholder
app.post('/api/predict_streak', (req: Request, res: Response) => {
  res.status(501).json({
    error: 'Not Implemented',
    message: 'Four-race streak prediction requires dedicated multi-sequence model.',
  });
});

// 404 handler
// 404 handler — safe wildcard
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Endpoint not found' });
});
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Equine Oracle Backend live on http://0.0.0.0:${PORT}`);
  console.log(`❤️  Health: http://0.0.0.0:${PORT}/health`);
  console.log(`📊 Model Info: http://0.0.0.0:${PORT}/api/model_info`);
});

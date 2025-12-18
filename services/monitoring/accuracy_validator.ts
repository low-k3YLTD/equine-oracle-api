// services/monitoring/accuracy_validator.ts

import { db } from '@/db';
import { predictions, raceResults, predictionAccuracy } from '@/db/schema/monitoring';
import { and, eq, gte } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export class AccuracyValidator {
  
  /**
   * Validate all predictions for a race once results are available
   */
  static async validatePrediction(raceId: string): Promise<void> {
    try {
      // Fetch all predictions for this race
      const racePredictions = await db
        .select()
        .from(predictions)
        .where(eq(predictions.raceId, raceId));

      if (racePredictions.length === 0) {
        console.log(`No predictions found for race ${raceId}`);
        return;
      }

      // Fetch ground truth
      const [result] = await db
        .select()
        .from(raceResults)
        .where(eq(raceResults.raceId, raceId));

      if (!result) {
        console.log(`No race result found for race ${raceId} — skipping validation`);
        return;
      }

      // Validate each prediction individually
      for (const prediction of racePredictions) {
        await this.calculateAccuracy(prediction, result);
      }

      console.log(`Successfully validated \( {racePredictions.length} predictions for race \){raceId}`);
    } catch (error) {
      console.error(`Failed to validate predictions for race ${raceId}:`, error);
      // Optionally trigger an alert here
      throw error;
    }
  }

  /**
   * Compute all accuracy metrics for a single prediction vs actual result
   */
  private static async calculateAccuracy(
    prediction: any,
    result: any
  ): Promise<void> {
    const predictedRankings = prediction.predictedRankings as Array<{ horse: string; rank: number; score: number }>;
    const actualRankings = result.actualRankings as Array<{ horse: string; position: number; odds: number }>;

    // Maps for quick lookup
    const actualPositionMap = new Map(actualRankings.map(r => [r.horse, r.position]));
    const actualOddsMap = new Map(actualRankings.map(r => [r.horse, r.odds]));

    // 1. Top pick correctness
    const topPickCorrect = prediction.topPick === result.winner;
    const topPickPosition = actualPositionMap.get(prediction.topPick) ?? null;

    // 2. Top-3 accuracy
    const predictedTop3 = predictedRankings.slice(0, 3).map(r => r.horse);
    const top3Accuracy = predictedTop3.includes(result.winner);

    // 3. Spearman rank correlation
    const rankCorrelation = this.calculateSpearmanCorrelation(predictedRankings, actualRankings);

    // 4. Confidence calibration error (simple absolute deviation)
    const confidenceError = topPickCorrect
      ? Math.abs(prediction.topPickConfidence - 1.0)
      : Math.abs(prediction.topPickConfidence - 0.0);

    // 5. Hypothetical betting outcome
    let bettingOutcome: 'win' | 'loss' | 'no_bet' = 'no_bet';
    let profitLoss = 0;

    if (prediction.bettingSignal && prediction.bettingSignal !== 'avoid') {
      const stake = 10; // fixed hypothetical stake
      if (topPickCorrect) {
        const winnerOdds = actualOddsMap.get(prediction.topPick) ?? 1;
        profitLoss = stake * (winnerOdds - 1);
        bettingOutcome = 'win';
      } else {
        profitLoss = -stake;
        bettingOutcome = 'loss';
      }
    }

    // Persist metrics
    await db.insert(predictionAccuracy).values({
      id: uuidv4(),
      predictionId: prediction.id,
      raceResultId: result.id,

      topPickCorrect,
      topPickPosition,
      top3Accuracy,
      rankCorrelation,
      confidenceError,

      bettingOutcome,
      profitLoss,
    });
  }

  /**
   * Spearman rank correlation coefficient
   * Returns value in [-1, 1], or null if insufficient overlapping horses
   */
  private static calculateSpearmanCorrelation(
    predicted: Array<{ horse: string; rank: number }>,
    actual: Array<{ horse: string; position: number }>
  ): number | null {
    const predMap = new Map(predicted.map(p => [p.horse, p.rank]));
    const actMap = new Map(actual.map(a => [a.horse, a.position]));

    const commonHorses = [...predMap.keys()].filter(h => actMap.has(h));
    if (commonHorses.length < 2) return null;

    const n = commonHorses.length;
    let sumDSquared = 0;

    for (const horse of commonHorses) {
      const d = (predMap.get(horse)! - actMap.get(horse)!);
      sumDSquared += d * d;
    }

    // Standard Spearman formula (assumes no ties — good enough for racing ranks)
    const correlation = 1 - (6 * sumDSquared) / (n * (n * n - 1));
    return Number(correlation.toFixed(4));
  }
  }

export interface EtaEstimate {
  estimatedMs: number;
  sampleSize: number;
  isFallback: boolean;
}

export const PLANNING_ETA_FALLBACK_MS = 180000; // 3 minutes

/**
 * Estimator for planning ETA based on a rolling window of recent durations.
 * It remains pure and deterministic for easy testing.
 */
export class PlanningEtaEstimator {
  /**
   * Estimates the ETA based on the provided durations.
   * If fewer than 10 records exist, it still averages them but indicates if it's based on a small sample.
   * If no records exist, it returns a fallback value.
   */
  public estimate(durationsMs: number[]): EtaEstimate {
    if (durationsMs.length === 0) {
      return {
        estimatedMs: PLANNING_ETA_FALLBACK_MS,
        sampleSize: 0,
        isFallback: true,
      };
    }

    const sum = durationsMs.reduce((acc, d) => acc + d, 0);
    const average = Math.round(sum / durationsMs.length);

    return {
      estimatedMs: average > 0 ? average : PLANNING_ETA_FALLBACK_MS,
      sampleSize: durationsMs.length,
      isFallback: false,
    };
  }
}

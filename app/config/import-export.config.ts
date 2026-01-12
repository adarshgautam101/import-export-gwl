/**
 * Centralized configuration for Import/Export functionality
 * All configurable values are defined here to avoid hardcoding throughout the application
 */

export const ImportExportConfig = {
    // API Retry Settings
    maxRetries: 3,
    retryDelayMs: 1000,

    // Batch Processing Settings
    batchSize: 5,
    delayBetweenBatchesMs: 1000,

    // Discount Default Values
    defaultPercentageDiscount: 15, // Default percentage if not provided
    defaultBuyXGetYDiscount: 100,  // Default discount for buy-x-get-y (100 = free)
    maxCodeGenerationAttempts: 10, // Maximum attempts to generate unique discount code

    // Discount Code Generation Retry Thresholds
    codeRetryThreshold1: 3, // After this many attempts, append timestamp
    codeRetryThreshold2: 6, // After this many attempts, append random chars
} as const;

// Type for the config
export type ImportExportConfigType = typeof ImportExportConfig;
